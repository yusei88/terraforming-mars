// Coaching about one option the player chose (P3-CD, `coach-counsel/1`), served by
// `POST api/coach/counsel`. Facts come from the game and the analysis only; the coaching points are made
// from templates, or by a language model when the server allows it and the player agreed, and every
// point names the facts it rests on. See docs/coach/phase3/choice-driven-design.md §5.2.
import {CoachLabel} from './CoachChoiceList';

export const COACH_COUNSEL_REQUEST_SCHEMA = 'coach-counsel-request/1';
export const COACH_COUNSEL_SCHEMA = 'coach-counsel/1';

export type CoachCounselRequest = {
  schemaVersion: typeof COACH_COUNSEL_REQUEST_SCHEMA,
  positionToken: string,
  choiceId: string,
  compareWithChoiceId?: string | null,
  /** `facts`: only the facts (no coaching, no model). `review`: facts and coaching. */
  mode: 'facts' | 'review',
  /** UI language of the player (`jp`, `en`, …). */
  language: string,
  /** The player agreed to send the position to the external model. */
  aiConsent: boolean,
};

export type FactSupport = 'verified' | 'conditional' | 'unknown';

export const FACT_KINDS = ['game', 'resources', 'cost', 'plan', 'link', 'blocker', 'forecast', 'unmodeled', 'option'] as const;
export type FactKind = typeof FACT_KINDS[number];

/** One fact of the game or the analysis. `about` says which choice it belongs to (A selected, B compared). */
export type CoachFact = {
  id: string,
  about: 'A' | 'B' | 'game',
  kind: FactKind,
  value: Readonly<Record<string, unknown>>,
  support: FactSupport,
};

export type CoachPoint = {
  about: 'A' | 'B',
  /** Text written by the model, in the player's language. */
  text?: string,
  /** Template written by the server (translated by the client). */
  template?: CoachLabel,
  evidenceIds: ReadonlyArray<string>,
  support: FactSupport,
};

export type CoachCounselV1 = {
  schemaVersion: typeof COACH_COUNSEL_SCHEMA,
  positionToken: string,
  selectedChoiceId: string,
  compareWithChoiceId?: string,
  /**
   * - `ready`: facts (and coaching for `review`) for the current position.
   * - `fallback`: the model was asked but its answer was not used; the coaching comes from templates.
   * - `stale`: the position changed while the answer was made; nothing of it is current.
   */
  status: 'ready' | 'fallback' | 'stale',
  source: 'none' | 'template' | 'model',
  facts: ReadonlyArray<CoachFact>,
  strengths: ReadonlyArray<CoachPoint>,
  risks: ReadonlyArray<CoachPoint>,
  outlook: ReadonlyArray<CoachPoint>,
  question?: CoachPoint,
  limitations: ReadonlyArray<string>,
  ai: {state: 'off' | 'no-consent' | 'used' | 'failed', category?: string, elapsedMs?: number},
};
