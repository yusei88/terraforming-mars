// Decision history of human players for later review (schema `coach-trace/1`).
//
// One JSON object per line in `<COACH_TRACE_DIR>/<game>.trace.jsonl`; the snapshots the events refer to are
// in `<game>.states.jsonl`, once per player and fingerprint. Records hold player colour and name, never
// player, spectator or game ids.
import {Color} from '@/common/Color';
import {InputResponse} from '@/common/inputs/InputResponse';
import {CoachChoice, CoachStateV1, CoachStateVersion} from './CoachState';

export const COACH_TRACE_SCHEMA = 'coach-trace/1';

/** Pointer to a snapshot in the states file, as it was at the moment of one event. */
export type CoachStateRef = {
  fingerprint: string,
  /**
   * Advisory fingerprint of the snapshot (Phase 1.5).
   *
   * Absent in Phase 1 records: those can only be matched by content, warnings may differ.
   */
  advisoryFingerprint?: string,
  stateKey: string,
  version: CoachStateVersion,
  /**
   * Timeline the state belongs to: 0 from the start, +1 after every undo or cancelled action.
   *
   * Equal fingerprints on different branches mean the same position reached again.
   */
  branch: number,
};

type TraceBase = {
  schemaVersion: typeof COACH_TRACE_SCHEMA,
  /** Order of the event within this game's trace (starts at 1). */
  seq: number,
  recordedAt: string,
  player: {color: Color, name: string},
};

/** An answer the game accepted. */
export type CoachDecisionEvent = TraceBase & {
  type: 'decision',
  /** State while the question was open (before the answer). */
  before: CoachStateRef,
  /** The question as offered, normalized. */
  offered: CoachChoice | undefined,
  response: InputResponse,
  /** When the question was shown, if the server knew it. */
  askedAt?: string,
  decidedAt: string,
  thinkingMilliseconds?: number,
  /**
   * First state the player could see after the answer.
   *
   * It may already include automatic steps (production, other players' AI moves).
   */
  after: CoachStateRef,
};

/** An answer the game refused; the state did not change because of it. */
export type CoachRejectedInputEvent = TraceBase & {
  type: 'rejected',
  before: CoachStateRef,
  response: InputResponse,
  error: string,
  decidedAt: string,
};

/** An undo or cancelled action: later decisions on the old branch were withdrawn. */
export type CoachRevertEvent = TraceBase & {
  type: 'revert',
  kind: 'undo' | 'cancel-action',
  from: CoachStateRef,
  /** Undefined when the rollback failed (the game stayed at `from`). */
  to: CoachStateRef | undefined,
};

/** Trust in the recorded history compared with the game as it is now. */
export const HISTORY_STATUSES = ['valid', 'rollback-detected', 'uncertain', 'disabled'] as const;
export type HistoryStatus = typeof HISTORY_STATUSES[number];

/**
 * A mismatch between the history and the game, found when the game was next observed (Phase 1.5).
 *
 * Written at the next answer after it was found, never by reading. Earlier events stay in the file.
 */
export type CoachIntegrityEvent = TraceBase & {
  type: 'integrity',
  status: 'rollback-detected' | 'uncertain',
  reason: string,
  /** Event whose state was the last confirmed game progress, and that state. */
  lastConfirmed: {seq: number, ref: CoachStateRef},
  /** State the game actually had when the mismatch was found (starts a new branch for a rollback). */
  observed: CoachStateRef,
};

export type CoachTraceEvent = CoachDecisionEvent | CoachRejectedInputEvent | CoachRevertEvent | CoachIntegrityEvent;

/**
 * Whether an event belongs to the line of play that led to the current game.
 *
 * - `current`: yes, as far as the history shows.
 * - `superseded`: no; it was undone, cancelled or lost in a detected rollback.
 * - `unverified`: cannot be decided (uncertain integrity); do not use it as a confirmed decision.
 */
export type EventSeries = 'current' | 'superseded' | 'unverified';

/** One line of the states file. */
export type CoachStateRecord = {
  type: 'state',
  color: Color,
  fingerprint: string,
  /** Absent in Phase 1 records. */
  advisoryFingerprint?: string,
  state: CoachStateV1,
};

/** Which state of an event `position` names. */
export const EVENT_POSITIONS = ['before', 'after', 'from', 'to', 'observed'] as const;
export type EventPosition = typeof EVENT_POSITIONS[number];

/**
 * A snapshot looked up by its place in history (`seq` + `position`), not by content.
 *
 * `reference` is the truth about when: the event's own counters and branch. The snapshot body is shared
 * by every moment with the same content, so its `version`, `stateKey` and `capturedAt` are replaced by
 * those of the reference; the values of the first capture are in `firstCapture`.
 */
export type CoachHistorySnapshot = {
  reference: CoachStateRef & {seq: number, position: EventPosition, recordedAt: string, series: EventSeries},
  /** `exact`: content and warnings match. `legacy-content-only`: Phase 1 record, warnings may differ. */
  precision: 'exact' | 'legacy-content-only',
  firstCapture: {capturedAt: string, stateKey: string},
  snapshot: CoachStateV1,
};
