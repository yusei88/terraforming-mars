// Step-by-step reflection on one finding (P3-SOLO-3, `coach-reflection/1`), served by
// `POST api/coach/reflection`. The questions come first; the comparison with the alternative only when the
// player asks for it. See docs/coach/phase3/solo-coach-design.md §6.
import {CoachLabel} from './CoachChoiceList';
import {FindingKind} from './CoachFindings';

export const COACH_REFLECTION_REQUEST_SCHEMA = 'coach-reflection-request/1';
export const COACH_REFLECTION_SCHEMA = 'coach-reflection/1';

/**
 * - `question`: the next question for the answers given so far (Gate A, B, C, then done).
 * - `hint`: a point of view to consider (no conclusion).
 * - `rules`: rules and card facts that apply (certain facts only).
 * - `explain`: the comparison with the alternative, with its evidence (the player asked for it).
 */
export type ReflectionView = 'question' | 'hint' | 'rules' | 'explain';

export type CoachReflectionRequest = {
  schemaVersion: typeof COACH_REFLECTION_REQUEST_SCHEMA,
  findingId: string,
  /** Keys of the options chosen so far, one per gate (at most 3). */
  answers: ReadonlyArray<string>,
  view: ReflectionView,
};

export type ReflectionGate = 'A' | 'B' | 'C' | 'done';

export type CoachReflectionV1 = {
  schemaVersion: typeof COACH_REFLECTION_SCHEMA,
  findingId: string,
  /** `gone`: the finding no longer exists (e.g. after an undo); nothing else is returned. */
  status: 'ok' | 'gone',
  kind?: FindingKind,
  /** The decision looked back on (always a past decision). */
  about?: CoachLabel,
  view: ReflectionView,
  gate?: ReflectionGate,
  question?: CoachLabel,
  options?: ReadonlyArray<{key: string, label: CoachLabel}>,
  /** Lines to show: facts (Gate C), a hint, rules, or the explanation. */
  lines?: ReadonlyArray<CoachLabel>,
};

/** A hint about a move the player is about to make (before acting; off unless the player turns it on). */
export type UpcomingHint = {id: string, kind: 'play-order-discount', cards: ReadonlyArray<string>};
