// Coach chat (Phase 3): what the language model sees and what it must answer.
//
// The model only interprets and talks. Cards, costs, plans and every other game fact come from the
// server (CoachStateV1 / CoachAnalysisV1); the model receives a compact, anonymous context built from
// them and answers in a fixed structure that the server checks before anything is shown.
import {PlanGoal, ResourceAmounts} from './CoachAnalysis';

export const COACH_CHAT_SCHEMA = 'coach-chat/1';

export const COACH_CHAT_MODES = ['question', 'hint', 'compare', 'explain'] as const;
/**
 * - `question`: ask the player questions that help them decide (default).
 * - `hint`: point at what to look at, without deciding for the player.
 * - `compare`: compare plans side by side.
 * - `explain`: explain a plan, a requirement or a number of the analysis.
 */
export type CoachChatMode = typeof COACH_CHAT_MODES[number];

/** One plan as the model sees it. `id` is a short alias (P1…), never the server's plan id. */
export type CoachLLMPlan = {
  id: string,
  goal: PlanGoal,
  goals: ReadonlyArray<PlanGoal>,
  /** `verified`, or `conditional` with the assumptions it rests on. */
  support: 'verified' | 'conditional' | 'unsupported',
  assumptions: ReadonlyArray<string>,
  cards: ReadonlyArray<{
    name: string,
    zone: 'played' | 'hand' | 'offered',
    availability: 'legal-now' | 'conditional' | 'unknown',
    cost: number | 'unknown',
    purchaseCost?: number,
  }>,
  links: ReadonlyArray<{kind: string, from: string, to: string, amount?: number, completes?: boolean, alreadyApplied?: boolean, playFirst?: string}>,
  blockers: ReadonlyArray<{card: string, kind: string, observed: number | 'unknown', target: number | 'unknown', gap: number | 'unknown', status: string, permanentlyUnmet?: boolean}>,
  payments: {play: number | 'unknown', purchase: number},
  forecast?: {
    productionPhases: number,
    productionsLeft: number | 'unknown',
    complete: boolean,
    /** Difference to not playing the plan after the last production phase covered. */
    afterLastProduction: {resources: ResourceAmounts, production: ResourceAmounts, terraformRating: number} | undefined,
    megacredits: {returned: number, balance: number, recovered: boolean} | 'unknown',
    victoryPoints: {total: number, terraformRating: number, cards: number} | 'unknown',
    unmodeledEffects: ReadonlyArray<string>,
  },
};

/** Everything the model may know about the position. No ids, no names of people, no hidden cards. */
export type CoachLLMContext = {
  game: {
    mode: 'solo' | 'multiplayer',
    playerCount: number,
    generation: number,
    phase: string,
    /** Solo only: the last generation of the game. */
    lastGeneration?: number,
    temperature: {value: number, max: number},
    oxygen: {value: number, max: number},
    oceans: {value: number, max: number},
    gameOver: boolean,
  },
  me: {
    color: string,
    terraformRating: number,
    resources: ResourceAmounts,
    production: ResourceAmounts,
    steelValue: number,
    titaniumValue: number,
    tags: Readonly<Record<string, number>>,
    corporations: ReadonlyArray<string>,
    played: ReadonlyArray<string>,
    hand: ReadonlyArray<{name: string, cost: number | 'unknown'}>,
    offered: ReadonlyArray<{name: string, cost: number | 'unknown'}>,
  },
  /** Public information about the other players only. */
  opponents: ReadonlyArray<{color: string, terraformRating: number, production: ResourceAmounts, tags: Readonly<Record<string, number>>, cardsInHand: number, played: ReadonlyArray<string>}>,
  /** What the game asks the player now (titles of the offered options only). */
  now: {status: string, options: ReadonlyArray<string>},
  analysis: {
    horizonProductionPhases: number,
    plans: ReadonlyArray<CoachLLMPlan>,
    coverage: {supported: number, partial: number, unsupported: number},
    searchTruncated: boolean,
    warnings: ReadonlyArray<string>,
    limitations: ReadonlyArray<string>,
  },
};

/** The structured answer the model must return (checked by the server before it is shown). */
export type CoachModelReply = {
  /** Plain text for the player, in the player's language. */
  message: string,
  /** Plans the message talks about (aliases from the context). */
  planIds: ReadonlyArray<string>,
  /** Cards the message talks about, exactly as named in the context. */
  cards: ReadonlyArray<string>,
  /** Up to three short questions the player could ask next. */
  followUpQuestions: ReadonlyArray<string>,
};
