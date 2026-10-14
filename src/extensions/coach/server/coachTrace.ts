import {IPlayer} from '@/server/IPlayer';
import {GameId} from '@/common/Types';
import {Color} from '@/common/Color';
import {PlayerInputObserver, RevertKind} from '@/server/extensions/inputObservers';
import {CoachStateV1} from '../common/CoachState';
import {
  COACH_TRACE_SCHEMA,
  CoachDecisionEvent,
  CoachHistorySnapshot,
  CoachStateRecord,
  CoachStateRef,
  CoachTraceEvent,
  EventPosition,
  EventSeries,
} from '../common/CoachTrace';
import {projectCoachState} from './projectCoachState';
import {annotateSeries, assessIntegrity, confirmedPoints, IntegrityAssessment} from './integrity';
import {fileSink, TraceHealth, TraceSink} from './traceStore';

export {fileSink, memorySink, traceFileName} from './traceStore';
export type {TraceFile, TraceSink} from './traceStore';

type Cursor = {
  seq: number,
  branch: number,
  /** Snapshots known to be stored, by `color:fingerprint:advisoryFingerprint`. */
  states: Set<string>,
  /** Events stored so far (oldest first); kept for the integrity check. */
  events: Array<CoachTraceEvent>,
};

type Stamped = 'schemaVersion' | 'seq' | 'recordedAt';
type EventBody<E> = E extends unknown ? Omit<E, Stamped> : never;

/** Events of a player with the line of play they belong to. */
export type SeriesEvent = CoachTraceEvent & {series: EventSeries};

/** Tracer health as reported by the decisions API. No paths, no ids. */
export type CoachTraceHealth = TraceHealth & {
  /** Events not written because a snapshot they refer to could not be stored. */
  eventsDropped: number,
};

function isEvent(value: unknown): value is CoachTraceEvent {
  return typeof value === 'object' && value !== null && (value as {schemaVersion?: unknown}).schemaVersion === COACH_TRACE_SCHEMA;
}

function stateKeyOf(color: Color, state: Pick<CoachStateV1, 'fingerprint' | 'advisoryFingerprint'>): string {
  return `${color}:${state.fingerprint}:${state.advisoryFingerprint ?? ''}`;
}

/**
 * Recorder of human decisions, rejected answers, rollbacks and integrity findings as coach-trace/1 events.
 *
 * Writes snapshots before the events that refer to them, and an event only when all of them are stored:
 * a reader may find a snapshot without event, never an event without snapshot. `seq` advances only
 * for events actually written. A write failure is counted and never stops the game.
 */
export class CoachTracer {
  private readonly cursors = new Map<GameId, Cursor>();
  private dropped = 0;

  constructor(private readonly sink: TraceSink, private readonly clock: () => Date = () => new Date()) {}

  private readEvents(gameId: GameId): Array<CoachTraceEvent> {
    return this.sink.read(gameId, 'trace').records.filter(isEvent).sort((a, b) => a.seq - b.seq);
  }

  private cursor(gameId: GameId): Cursor {
    let cursor = this.cursors.get(gameId);
    if (cursor === undefined) {
      // After a server restart, continue the numbering and branches of the existing file.
      const events = this.readEvents(gameId);
      const states = this.sink.read(gameId, 'states').records as Array<Partial<CoachStateRecord>>;
      cursor = {
        seq: events.reduce((max, event) => Math.max(max, event.seq), 0),
        branch: events.reduce((max, event) => Math.max(max, ...this.refsOf(event).map((ref) => ref.branch)), 0),
        states: new Set(states.map((record) => `${record.color}:${record.fingerprint}:${record.advisoryFingerprint ?? ''}`)),
        events,
      };
      this.cursors.set(gameId, cursor);
    }
    return cursor;
  }

  private refsOf(event: CoachTraceEvent): Array<CoachStateRef> {
    switch (event.type) {
    case 'decision':
      return [event.before, event.after];
    case 'rejected':
      return [event.before];
    case 'revert':
      return event.to === undefined ? [event.from] : [event.from, event.to];
    case 'integrity':
      return [event.lastConfirmed.ref, event.observed];
    }
  }

  private ref(state: CoachStateV1, cursor: Cursor): CoachStateRef {
    return {
      fingerprint: state.fingerprint,
      advisoryFingerprint: state.advisoryFingerprint,
      stateKey: state.stateKey,
      version: state.version,
      branch: cursor.branch,
    };
  }

  /** Stores the snapshot unless already stored; true when it is stored now. */
  private keepState(gameId: GameId, color: Color, state: CoachStateV1, cursor: Cursor): boolean {
    const key = stateKeyOf(color, state);
    if (cursor.states.has(key)) {
      return true;
    }
    const record: CoachStateRecord = {
      type: 'state', color, fingerprint: state.fingerprint, advisoryFingerprint: state.advisoryFingerprint, state,
    };
    if (!this.sink.append(gameId, 'states', record).ok) {
      return false;
    }
    cursor.states.add(key);
    return true;
  }

  /** Stores all snapshots, in order; false (and the event is dropped) if any could not be stored. */
  private keepStates(gameId: GameId, color: Color, states: ReadonlyArray<CoachStateV1>, cursor: Cursor): boolean {
    for (const state of states) {
      if (!this.keepState(gameId, color, state, cursor)) {
        this.dropped++;
        return false;
      }
    }
    return true;
  }

  /** Writes the event with the next `seq`; the number is used up only if the write succeeded. */
  private emit(gameId: GameId, event: EventBody<CoachTraceEvent>, cursor: Cursor): boolean {
    const seq = cursor.seq + 1;
    const record = {schemaVersion: COACH_TRACE_SCHEMA, seq, recordedAt: this.clock().toISOString(), ...event} as CoachTraceEvent;
    if (!this.sink.append(gameId, 'trace', record).ok) {
      return false;
    }
    cursor.seq = seq;
    cursor.events.push(record);
    return true;
  }

  /**
   * Records a mismatch between history and game before the next event, once per mismatch.
   *
   * A rollback starts a new branch, so later events never mix with the lost line of play.
   */
  private checkIntegrity(gameId: GameId, player: IPlayer, observed: CoachStateV1, cursor: Cursor) {
    const assessment = assessIntegrity(cursor.events, {color: player.color, fingerprint: observed.fingerprint, version: observed.version});
    if (assessment.status !== 'rollback-detected' && assessment.status !== 'uncertain') {
      return;
    }
    if (assessment.lastConfirmed === undefined || !this.keepStates(gameId, player.color, [observed], cursor)) {
      return;
    }
    const branch = assessment.status === 'rollback-detected' ? cursor.branch + 1 : cursor.branch;
    const written = this.emit(gameId, {
      type: 'integrity',
      player: {color: player.color, name: player.name},
      status: assessment.status,
      reason: assessment.reason,
      lastConfirmed: assessment.lastConfirmed,
      observed: {...this.ref(observed, cursor), branch},
    }, cursor);
    if (written) {
      cursor.branch = branch;
    }
  }

  public readonly observer: PlayerInputObserver = {
    name: 'coach-trace',
    beforeInput: (player, response, thinkingMilliseconds) => {
      if (player.aiLevel !== undefined) {
        return undefined;
      }
      const gameId = player.game.id;
      const before = projectCoachState(player, this.clock());
      const offered = before.choices.status === 'awaiting-input' ? before.choices.root : undefined;
      return (outcome) => {
        const cursor = this.cursor(gameId);
        this.checkIntegrity(gameId, player, before, cursor);
        const decidedAt = this.clock();
        const who = {color: player.color, name: player.name};
        if (!outcome.accepted) {
          if (this.keepStates(gameId, player.color, [before], cursor)) {
            this.emit(gameId, {type: 'rejected', player: who, before: this.ref(before, cursor), response, error: outcome.error, decidedAt: decidedAt.toISOString()}, cursor);
          }
          return;
        }
        const after = projectCoachState(player, decidedAt);
        if (!this.keepStates(gameId, player.color, [before, after], cursor)) {
          return;
        }
        const event: EventBody<CoachDecisionEvent> = {
          type: 'decision',
          player: who,
          before: this.ref(before, cursor),
          offered,
          response,
          decidedAt: decidedAt.toISOString(),
          after: this.ref(after, cursor),
        };
        if (thinkingMilliseconds !== undefined) {
          event.thinkingMilliseconds = Math.round(thinkingMilliseconds);
          event.askedAt = new Date(decidedAt.getTime() - thinkingMilliseconds).toISOString();
        }
        this.emit(gameId, event, cursor);
      };
    },
    beforeRevert: (player: IPlayer, kind: RevertKind) => {
      const gameId = player.game.id;
      const from = projectCoachState(player, this.clock());
      return (restored) => {
        const cursor = this.cursor(gameId);
        this.checkIntegrity(gameId, player, from, cursor);
        const who = {color: player.color, name: player.name};
        if (restored === undefined) {
          if (this.keepStates(gameId, player.color, [from], cursor)) {
            this.emit(gameId, {type: 'revert', kind, player: who, from: this.ref(from, cursor), to: undefined}, cursor);
          }
          return;
        }
        const to = projectCoachState(restored, this.clock());
        if (!this.keepStates(gameId, player.color, [from, to], cursor)) {
          return;
        }
        const fromRef = this.ref(from, cursor);
        const toRef = {...this.ref(to, cursor), branch: cursor.branch + 1};
        if (this.emit(gameId, {type: 'revert', kind, player: who, from: fromRef, to: toRef}, cursor)) {
          cursor.branch = toRef.branch;
        }
      };
    },
  };

  /** Events of one player (by colour), oldest first, with their series. Other players' events are left out. */
  public eventsOf(gameId: GameId, color: Color): Array<SeriesEvent> {
    const events = this.readEvents(gameId);
    const series = annotateSeries(events);
    return events
      .filter((event) => event.player.color === color)
      .map((event) => ({...event, series: series.get(event.seq) ?? 'current'}));
  }

  /**
   * The first snapshot `color` saw with this content (Phase 1 lookup).
   *
   * Content only: the same content can occur at several places in history, so this does not say when.
   * Use `historySnapshot` for a place in history.
   */
  public stateOf(gameId: GameId, color: Color, fingerprint: string): CoachStateV1 | undefined {
    const records = this.sink.readMatching(gameId, 'states', fingerprint) as Array<CoachStateRecord>;
    return records.find((record) => record.color === color && record.fingerprint === fingerprint)?.state;
  }

  /** The snapshot of one event of `color` at `position`, with the event's own place in history. */
  public historySnapshot(gameId: GameId, color: Color, seq: number, position: EventPosition): CoachHistorySnapshot | undefined {
    const events = this.readEvents(gameId);
    const event = events.find((e) => e.seq === seq);
    if (event === undefined || event.player.color !== color) {
      return undefined;
    }
    const ref = this.refAt(event, position);
    if (ref === undefined) {
      return undefined;
    }
    const records = (this.sink.readMatching(gameId, 'states', ref.fingerprint) as Array<CoachStateRecord>)
      .filter((record) => record.color === color && record.fingerprint === ref.fingerprint);
    const exact = ref.advisoryFingerprint === undefined ? undefined : records.find((record) => record.advisoryFingerprint === ref.advisoryFingerprint);
    const record = exact ?? records[0];
    if (record === undefined) {
      return undefined;
    }
    const series = annotateSeries(events).get(seq) ?? 'current';
    return {
      reference: {...ref, seq, position, recordedAt: event.recordedAt, series},
      precision: exact !== undefined ? 'exact' : 'legacy-content-only',
      firstCapture: {capturedAt: record.state.capturedAt, stateKey: record.state.stateKey},
      snapshot: {...record.state, version: ref.version, stateKey: ref.stateKey, capturedAt: event.recordedAt},
    };
  }

  private refAt(event: CoachTraceEvent, position: EventPosition): CoachStateRef | undefined {
    switch (event.type) {
    case 'decision':
      return position === 'before' ? event.before : position === 'after' ? event.after : undefined;
    case 'rejected':
      return position === 'before' ? event.before : undefined;
    case 'revert':
      return position === 'from' ? event.from : position === 'to' ? event.to : undefined;
    case 'integrity':
      return position === 'observed' ? event.observed : undefined;
    }
  }

  /** Read-only comparison of the recorded history with the game as `player` sees it now. */
  public assess(player: IPlayer, state: CoachStateV1): IntegrityAssessment {
    const events = this.readEvents(player.game.id);
    return assessIntegrity(events, {color: player.color, fingerprint: state.fingerprint, version: state.version});
  }

  /** The last confirmed progress of the game (for diagnostics). */
  public lastConfirmed(gameId: GameId) {
    return confirmedPoints(this.readEvents(gameId)).latest;
  }

  public health(): CoachTraceHealth {
    return {...this.sink.health(), eventsDropped: this.dropped};
  }
}

let tracer: CoachTracer | undefined;
let configured = false;

/** The tracer of this server: enabled by `COACH_TRACE_DIR`, otherwise undefined (no file access at all). */
export function getCoachTracer(): CoachTracer | undefined {
  if (!configured) {
    configured = true;
    const directory = process.env.COACH_TRACE_DIR;
    if (directory !== undefined && directory.trim() !== '') {
      tracer = new CoachTracer(fileSink(directory.trim()));
    }
  }
  return tracer;
}

/** for testing */
export function setCoachTracer(next: CoachTracer | undefined): void {
  tracer = next;
  configured = true;
}

/** Observer registered by the extension; does nothing while tracing is off. */
export const coachTraceObserver: PlayerInputObserver = {
  name: 'coach-trace',
  beforeInput: (player, response, thinkingMilliseconds) => getCoachTracer()?.observer.beforeInput(player, response, thinkingMilliseconds),
  beforeRevert: (player, kind) => getCoachTracer()?.observer.beforeRevert?.(player, kind),
};
