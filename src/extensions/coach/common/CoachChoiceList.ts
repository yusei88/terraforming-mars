// What the player can choose to have coached (P3-CD, `coach-choice-list/1`), served by
// `GET api/coach/options`. See docs/coach/phase3/choice-driven-design.md §4–5.
//
// "Now" holds only inputs the game accepts from the player at this moment; "Future" holds the plans of
// the analysis, none of which is a single move. Choosing an option here never sends anything to the game.
import {PlanGoal} from './CoachAnalysis';

export const COACH_CHOICE_LIST_SCHEMA = 'coach-choice-list/1';

/** A text to show: a game or coach template (`${0}` …) and its parameters (card names are translated too). */
export type CoachLabel = {template: string, params: ReadonlyArray<{text: string, card?: boolean}>};

export const CHOICE_KINDS = [
  'project-card', 'standard-project', 'game-option', 'undo', 'blue-action', 'card-selection',
  'compound-input', 'input-not-analysed', 'strategy-plan',
] as const;
/**
 * - `project-card`: one card of "Play project card" (passed the game's `canPlay`: one move).
 * - `standard-project`: one standard project the player can do now.
 * - `game-option`: one fixed action of the game (convert heat, pass, fund an award…).
 * - `undo`: the game's undo option.
 * - `blue-action`: one card of "Perform an action from a played card" (the action asks more later).
 * - `card-selection`: a selection of cards as a whole (buying, selling patents, picking a corporation).
 * - `compound-input`: an input that needs answers to all of its parts (game start).
 * - `input-not-analysed`: any other input (tile placement, payment, …).
 * - `strategy-plan`: a plan of the analysis (1–3 cards).
 */
export type CoachChoiceKind = typeof CHOICE_KINDS[number];

export type CoachChoiceOption = {
  /** Opaque id made by the server for this position; the server rebuilds the list to check it. */
  id: string,
  group: 'now' | 'future',
  kind: CoachChoiceKind,
  label: CoachLabel,
  /** Title of the `or` this option sits in, when it is nested (e.g. "Fund an award"). */
  parentLabel?: CoachLabel,
  cardNames: ReadonlyArray<string>,
  /** Cost computed by the game (cards and standard projects). */
  cost?: number,
  /** Strategy plans only. */
  planGoal?: PlanGoal,
  /**
   * - `legal-now`: the game accepts it now (a plan only when it is a single playable card).
   * - `conditional`: a plan that needs earlier cards, purchases or resources first.
   * - `unknown`: a plan with a condition the analysis cannot check.
   * - `not-action`: an input that is not one move by itself (a selection, a compound input).
   */
  eligibility: 'legal-now' | 'conditional' | 'unknown' | 'not-action',
  selectableForCoaching: boolean,
  /** Reason codes, translated by the client (see coachText). */
  limitations: ReadonlyArray<string>,
};

export type CoachChoiceListV1 = {
  schemaVersion: typeof COACH_CHOICE_LIST_SCHEMA,
  /** Opaque token of the position (content, undo, step, analysis version); no secret id inside. */
  positionToken: string,
  analysisVersion: string,
  stateStatus: 'awaiting-input' | 'waiting-for-others' | 'resolving' | 'game-over',
  options: ReadonlyArray<CoachChoiceOption>,
  /** Inputs left out of "Now", with a reason code (e.g. standard projects that cannot be done now). */
  omitted: ReadonlyArray<{reason: string, count: number}>,
  /** True when the server is set up to use an external model (the player's consent is still needed). */
  ai: {available: boolean},
  warnings: ReadonlyArray<string>,
};
