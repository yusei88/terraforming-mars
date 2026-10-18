// The player's decisions in a solo game as meaningful events (P3-SOLO-1, `coach-timeline/1`), served by
// `GET api/coach/timeline`. Built from the decision history (coach-trace/1) and the snapshots it refers
// to; see docs/coach/phase3/solo-coach-design.md §3–4.
import {EventSeries} from './CoachTrace';
import {HistoryStatus} from './CoachTrace';

export const COACH_TIMELINE_SCHEMA = 'coach-timeline/1';

/** How a solo game is won (from the game options). */
export type SoloRules = {
  /** `terraform`: all global parameters at their goal by the last generation. `tr63`: TR 63 by then. */
  victory: 'terraform' | 'tr63',
  lastGeneration: number,
};

export const TIMELINE_KINDS = [
  'buy-cards', 'initial-selection', 'play-card', 'standard-project', 'card-action', 'sell-patents',
  'pass', 'end-turn', 'game-option', 'follow-up', 'other', 'undo', 'cancel-action',
] as const;
/**
 * - `buy-cards`: one purchase of 0–n cards in the research phase (one event, not one per card).
 * - `initial-selection`: corporation and first cards at the start.
 * - `play-card`: one project card played from hand.
 * - `follow-up`: an answer in the middle of an action (a space, a payment, a target…).
 * - `undo` / `cancel-action`: the line of play was rolled back here.
 */
export type TimelineKind = typeof TIMELINE_KINDS[number];

export type ResourceSnapshot = {
  megacredits: number, steel: number, titanium: number, plants: number, energy: number, heat: number,
  production: Readonly<Record<'megacredits' | 'steel' | 'titanium' | 'plants' | 'energy' | 'heat', number>>,
  terraformRating: number,
  cardsInHand: number,
};

export type TimelineEvent = {
  /** `s<seq>`: stable id from the history. */
  id: string,
  seq: number,
  kind: TimelineKind,
  generation: number,
  phase: string,
  branch: number,
  series: EventSeries,
  /** Cards bought, played, used or sold (empty for a purchase of no card). */
  cards: ReadonlyArray<string>,
  /** Purchases: the cards that were offered. */
  offeredCards?: ReadonlyArray<string>,
  /** Start of the game: corporation (and preludes) chosen. */
  chosen?: ReadonlyArray<string>,
  /** Plays: cost computed by the game when the decision was taken. */
  cost?: number,
  /** Plays: what the player paid. */
  payment?: Readonly<Record<string, number>>,
  /** Title of the game's option (English, translated by the client), for options and other inputs. */
  label?: string,
  before?: ResourceSnapshot,
  after?: ResourceSnapshot,
  /** True when the states before and after confirm the meaning (e.g. the card went from hand to play). */
  verified: boolean,
  /** Place of the action in its generation, in the current line of play (1, 2, …); not for follow-ups. */
  order?: number,
};

export type CoachTimelineV1 = {
  schemaVersion: typeof COACH_TIMELINE_SCHEMA,
  /**
   * - `ok`: built from the history.
   * - `disabled`: the server does not keep a history (COACH_TRACE_DIR not set): nothing to show.
   * - `unreadable`: the history could not be read.
   * - `not-solo`: this coaching is for solo games only.
   */
  status: 'ok' | 'disabled' | 'unreadable' | 'not-solo',
  history: HistoryStatus,
  solo?: SoloRules,
  /** Current (and unverified) events by generation, oldest first. */
  generations: ReadonlyArray<{generation: number, events: ReadonlyArray<TimelineEvent>}>,
  /** Events withdrawn by an undo, a cancelled action or a detected rollback. */
  superseded: ReadonlyArray<TimelineEvent>,
  /** The position now. `victoryPoints` is the current score, not a forecast. */
  now: {generation: number, phase: string, terraformRating: number, victoryPoints?: number},
  /** True when the history was longer than the limit and only its start was used. */
  truncated: boolean,
};
