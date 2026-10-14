import {Color} from '@/common/Color';
import {CoachStateVersion} from '../common/CoachState';
import {CoachStateRef, CoachTraceEvent, EventSeries, HistoryStatus} from '../common/CoachTrace';

// Light consistency check between the recorded history and the game as it is now. A game restored from
// an older save (server restart or cache reload without undo saves) silently drops recent moves; the
// history must then stop presenting them as the line of play. Pure functions: nothing is written here.

/** Game progress the history vouches for: the state after the latest accepted move or rollback. */
export type ConfirmedPoint = {seq: number, color: Color, ref: CoachStateRef};

export type IntegrityAssessment = {
  status: HistoryStatus,
  reason: string,
  lastConfirmed?: {seq: number, ref: CoachStateRef},
};

/** What the game shows now, as one player sees it. */
export type ObservedState = {color: Color, fingerprint: string, version: CoachStateVersion};

const COUNTERS = ['generation', 'gameStep', 'gameAge'] as const;

/* The state an event confirms as reached; rejected answers and failed rollbacks confirm nothing. */
function confirmedRef(event: CoachTraceEvent): CoachStateRef | undefined {
  switch (event.type) {
  case 'decision':
    return event.after;
  case 'revert':
    return event.to;
  case 'integrity':
    return event.observed;
  case 'rejected':
    return undefined;
  }
}

/** Latest confirmed progress overall and per player colour. */
export function confirmedPoints(events: ReadonlyArray<CoachTraceEvent>): {latest?: ConfirmedPoint, byColor: Map<Color, ConfirmedPoint>} {
  let latest: ConfirmedPoint | undefined;
  const byColor = new Map<Color, ConfirmedPoint>();
  for (const event of events) {
    const ref = confirmedRef(event);
    if (ref === undefined) {
      continue;
    }
    const point = {seq: event.seq, color: event.player.color, ref};
    if (latest === undefined || point.seq > latest.seq) {
      latest = point;
    }
    const previous = byColor.get(point.color);
    if (previous === undefined || point.seq > previous.seq) {
      byColor.set(point.color, point);
    }
  }
  return {latest, byColor};
}

function compareCounters(now: CoachStateVersion, then: CoachStateVersion): {lower: Array<string>, higher: Array<string>} {
  const lower: Array<string> = [];
  const higher: Array<string> = [];
  for (const counter of COUNTERS) {
    if (now[counter] < then[counter]) {
      lower.push(`${counter} ${then[counter]}→${now[counter]}`);
    } else if (now[counter] > then[counter]) {
      higher.push(counter);
    }
  }
  return {lower, higher};
}

/**
 * Compares the game now with the last progress the history recorded.
 *
 * - Every counter equal or ahead: `valid` (normal play, also other players' moves).
 * - Some counter behind, none ahead: `rollback-detected` (moves after the last save were lost).
 * - Behind and ahead at once, or equal counters but other content for the same player: `uncertain`.
 */
export function assessIntegrity(events: ReadonlyArray<CoachTraceEvent>, now: ObservedState): IntegrityAssessment {
  const {latest, byColor} = confirmedPoints(events);
  if (latest === undefined) {
    return {status: 'valid', reason: 'no recorded progress yet'};
  }
  const lastConfirmed = {seq: latest.seq, ref: latest.ref};
  const {lower, higher} = compareCounters(now.version, latest.ref.version);
  if (lower.length > 0 && higher.length === 0) {
    const undoNote = now.version.undoCount > latest.ref.version.undoCount ? '; undo count rose without a recorded undo' : '';
    return {status: 'rollback-detected', reason: `game went back (${lower.join(', ')}) after event ${latest.seq}${undoNote}`, lastConfirmed};
  }
  if (lower.length > 0) {
    return {status: 'uncertain', reason: `counters moved both ways (${lower.join(', ')}; ahead: ${higher.join(', ')})`, lastConfirmed};
  }
  if (higher.length === 0) {
    // Same counters. Content can only be compared with what this player saw, and only if nobody else
    // acted since (another player's move may change this player's view without moving counters).
    const own = byColor.get(now.color);
    if (own !== undefined && own.seq === latest.seq && own.ref.fingerprint !== now.fingerprint) {
      return {status: 'uncertain', reason: `same counters as event ${latest.seq} but different content`, lastConfirmed};
    }
  }
  return {status: 'valid', reason: higher.length > 0 ? 'game is ahead of the history' : 'game matches the history', lastConfirmed};
}

/* True when `state` lies beyond `target` in play (some counter further along). */
function beyond(state: CoachStateVersion, target: CoachStateVersion): boolean {
  return COUNTERS.some((counter) => state[counter] > target[counter]);
}

/* The state an event is about, for deciding whether a rollback dropped it. */
function positionOf(event: CoachTraceEvent): CoachStateRef | undefined {
  switch (event.type) {
  case 'decision':
    return event.after;
  case 'rejected':
    return event.before;
  default:
    return undefined;
  }
}

/**
 * Classifies every event as `current`, `superseded` or `unverified` (see EventSeries).
 *
 * An undo, cancelled action or detected rollback to a target state supersedes the earlier events of the
 * same branch that lie beyond that target. An `uncertain` finding marks the last confirmed event as
 * `unverified`; nothing is classified beyond what the history shows.
 */
export function annotateSeries(events: ReadonlyArray<CoachTraceEvent>): Map<number, EventSeries> {
  const series = new Map<number, EventSeries>();
  const seen: Array<CoachTraceEvent> = [];
  for (const event of events) {
    series.set(event.seq, 'current');
    let target: CoachStateRef | undefined;
    let branch: number | undefined;
    if (event.type === 'revert' && event.to !== undefined) {
      target = event.to;
      branch = event.from.branch;
    } else if (event.type === 'integrity' && event.status === 'rollback-detected') {
      target = event.observed;
      branch = event.lastConfirmed.ref.branch;
    } else if (event.type === 'integrity' && event.status === 'uncertain') {
      if (series.get(event.lastConfirmed.seq) === 'current') {
        series.set(event.lastConfirmed.seq, 'unverified');
      }
    }
    if (target !== undefined) {
      for (const earlier of seen) {
        const position = positionOf(earlier);
        if (position !== undefined && position.branch === branch && beyond(position.version, target.version)) {
          series.set(earlier.seq, 'superseded');
        }
      }
    }
    seen.push(event);
  }
  return series;
}
