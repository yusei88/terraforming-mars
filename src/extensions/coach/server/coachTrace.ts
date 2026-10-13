import * as fs from 'fs';
import * as path from 'path';
import {IPlayer} from '@/server/IPlayer';
import {GameId} from '@/common/Types';
import {Color} from '@/common/Color';
import {PlayerInputObserver, RevertKind} from '@/server/extensions/inputObservers';
import {CoachStateV1} from '../common/CoachState';
import {COACH_TRACE_SCHEMA, CoachDecisionEvent, CoachStateRecord, CoachStateRef, CoachTraceEvent} from '../common/CoachTrace';
import {projectCoachState} from './projectCoachState';

export type TraceFile = 'trace' | 'states';

/** Storage of trace lines, one JSON object per line and game. */
export type TraceSink = {
  append(gameId: GameId, file: TraceFile, record: object): void,
  read(gameId: GameId, file: TraceFile): Array<unknown>,
};

/** File name for a game's trace; game ids come from the server, but never let a separator through. */
export function traceFileName(directory: string, gameId: GameId, file: TraceFile): string {
  return path.join(directory, `${gameId.replace(/[^A-Za-z0-9_-]/g, '_')}.${file}.jsonl`);
}

/** Sink writing `<directory>/<game>.{trace,states}.jsonl`. Write errors are logged, never thrown. */
export function fileSink(directory: string): TraceSink {
  fs.mkdirSync(directory, {recursive: true});
  return {
    append(gameId, file, record) {
      try {
        fs.appendFileSync(traceFileName(directory, gameId, file), JSON.stringify(record) + '\n');
      } catch (error) {
        console.error('Could not write coach trace', error);
      }
    },
    read(gameId, file) {
      const name = traceFileName(directory, gameId, file);
      if (!fs.existsSync(name)) {
        return [];
      }
      return fs.readFileSync(name, 'utf8').split('\n').filter((line) => line.length > 0).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          // A line cut by a crash: skip it, keep the rest readable.
          return [];
        }
      });
    },
  };
}

/** Sink keeping lines in memory. */
export function memorySink(): TraceSink & {lines: Map<string, Array<object>>} {
  const lines = new Map<string, Array<object>>();
  return {
    lines,
    append(gameId, file, record) {
      const key = `${gameId}.${file}`;
      lines.set(key, [...(lines.get(key) ?? []), JSON.parse(JSON.stringify(record))]);
    },
    read(gameId, file) {
      return lines.get(`${gameId}.${file}`) ?? [];
    },
  };
}

type Cursor = {seq: number, branch: number, states: Set<string>};

type Stamped = 'schemaVersion' | 'seq' | 'recordedAt';
type EventBody<E> = E extends unknown ? Omit<E, Stamped> : never;

function isEvent(value: unknown): value is CoachTraceEvent {
  return typeof value === 'object' && value !== null && (value as {schemaVersion?: unknown}).schemaVersion === COACH_TRACE_SCHEMA;
}

/**
 * Recorder of human decisions, rejected answers and rollbacks as coach-trace/1 events.
 *
 * Captures the state before an answer while the question is still open, and the state after it only
 * once the game accepted it. Never changes the game.
 */
export class CoachTracer {
  private readonly cursors = new Map<GameId, Cursor>();

  constructor(private readonly sink: TraceSink, private readonly clock: () => Date = () => new Date()) {}

  private cursor(gameId: GameId): Cursor {
    let cursor = this.cursors.get(gameId);
    if (cursor === undefined) {
      // After a server restart, continue the numbering of the existing file.
      const events = this.sink.read(gameId, 'trace').filter(isEvent);
      const states = this.sink.read(gameId, 'states') as Array<Partial<CoachStateRecord>>;
      cursor = {
        seq: events.reduce((max, event) => Math.max(max, event.seq), 0),
        branch: events.filter((event) => event.type === 'revert' && event.to !== undefined).length,
        states: new Set(states.map((record) => `${record.color}:${record.fingerprint}`)),
      };
      this.cursors.set(gameId, cursor);
    }
    return cursor;
  }

  private ref(state: CoachStateV1, cursor: Cursor): CoachStateRef {
    return {fingerprint: state.fingerprint, stateKey: state.stateKey, version: state.version, branch: cursor.branch};
  }

  private keepState(gameId: GameId, color: Color, state: CoachStateV1, cursor: Cursor) {
    const key = `${color}:${state.fingerprint}`;
    if (!cursor.states.has(key)) {
      cursor.states.add(key);
      const record: CoachStateRecord = {type: 'state', color, fingerprint: state.fingerprint, state};
      this.sink.append(gameId, 'states', record);
    }
  }

  private emit(gameId: GameId, event: EventBody<CoachTraceEvent>, cursor: Cursor) {
    cursor.seq++;
    const record = {schemaVersion: COACH_TRACE_SCHEMA, seq: cursor.seq, recordedAt: this.clock().toISOString(), ...event};
    this.sink.append(gameId, 'trace', record);
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
        const decidedAt = this.clock();
        const who = {color: player.color, name: player.name};
        this.keepState(gameId, player.color, before, cursor);
        const beforeRef = this.ref(before, cursor);
        if (!outcome.accepted) {
          this.emit(gameId, {type: 'rejected', player: who, before: beforeRef, response, error: outcome.error, decidedAt: decidedAt.toISOString()}, cursor);
          return;
        }
        const after = projectCoachState(player, decidedAt);
        this.keepState(gameId, player.color, after, cursor);
        const event: EventBody<CoachDecisionEvent> = {
          type: 'decision',
          player: who,
          before: beforeRef,
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
        this.keepState(gameId, player.color, from, cursor);
        const fromRef = this.ref(from, cursor);
        let toRef: CoachStateRef | undefined;
        if (restored !== undefined) {
          cursor.branch++;
          const to = projectCoachState(restored, this.clock());
          this.keepState(gameId, restored.color, to, cursor);
          toRef = this.ref(to, cursor);
        }
        this.emit(gameId, {type: 'revert', kind, player: {color: player.color, name: player.name}, from: fromRef, to: toRef}, cursor);
      };
    },
  };

  /** Events of one player (by colour), oldest first. Other players' events are left out. */
  public eventsOf(gameId: GameId, color: Color): Array<CoachTraceEvent> {
    return this.sink.read(gameId, 'trace').filter(isEvent).filter((event) => event.player.color === color);
  }

  /** The snapshot `color` saw with `fingerprint`, if it was recorded. */
  public stateOf(gameId: GameId, color: Color, fingerprint: string): CoachStateV1 | undefined {
    const records = this.sink.read(gameId, 'states') as Array<CoachStateRecord>;
    return records.find((record) => record.color === color && record.fingerprint === fingerprint)?.state;
  }
}

let tracer: CoachTracer | undefined;
let configured = false;

/** The tracer of this server: enabled by `COACH_TRACE_DIR`, otherwise undefined. */
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
