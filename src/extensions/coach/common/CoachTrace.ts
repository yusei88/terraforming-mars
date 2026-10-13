// Decision history of human players for later review (schema `coach-trace/1`).
//
// One JSON object per line in `<COACH_TRACE_DIR>/<game>.trace.jsonl`; the snapshots the events refer to are
// in `<game>.states.jsonl`, once per player and fingerprint. Records hold player colour and name, never
// player, spectator or game ids.
import {Color} from '@/common/Color';
import {InputResponse} from '@/common/inputs/InputResponse';
import {CoachChoice, CoachStateV1, CoachStateVersion} from './CoachState';

export const COACH_TRACE_SCHEMA = 'coach-trace/1';

/** Pointer to a snapshot in the states file. */
export type CoachStateRef = {
  fingerprint: string,
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

export type CoachTraceEvent = CoachDecisionEvent | CoachRejectedInputEvent | CoachRevertEvent;

/** One line of the states file. */
export type CoachStateRecord = {
  type: 'state',
  color: Color,
  fingerprint: string,
  state: CoachStateV1,
};
