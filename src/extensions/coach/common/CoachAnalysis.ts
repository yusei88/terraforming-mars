// Evidence and requirement types of the coach analysis (Phase 2, `coach-analysis/1`).
//
// Every number the analysis reports names where it comes from: a field of the CoachState snapshot, a
// field of the card catalog, a currently offered choice, or a check against the game engine in tests.
// Values that cannot be established are `'unknown'`, never a guess. No made-up confidence percentages.
import {CardName} from '@/common/cards/CardName';

export const COACH_ANALYSIS_SCHEMA = 'coach-analysis/1';

/** Source of one fact used by the analysis. */
export type Evidence = {
  kind: 'state' | 'catalog' | 'choice' | 'game-engine-test',
  /** JSON path inside the source (e.g. `me.tags.space`, `requirements[0]`). */
  fieldPath: string,
  cardName?: CardName,
  /** `fingerprint` of the CoachState the fact was read from. */
  stateFingerprint?: string,
};

/**
 * How well a conclusion is established.
 *
 * `verified` means: follows from observed values and supported effects. It does not promise anything
 * about the end of the game or unknown cards.
 */
export type Support =
  {level: 'verified', evidence: ReadonlyArray<Evidence>} |
  {level: 'conditional', assumptions: ReadonlyArray<string>, evidence: ReadonlyArray<Evidence>} |
  {level: 'unsupported', reason: string};

/** Distance between the current game and one requirement of a card. */
export type RequirementGap = {
  /** `cost`: what the player can pay (M€ plus usable steel/titanium/heat) against the card's cost. */
  kind: 'tag' | 'oxygen' | 'temperature' | 'oceans' | 'tr' | 'production' | 'greeneries' | 'cities' | 'cost' | 'other',
  /** The value the game compares (bonuses already applied), or unknown. */
  observed: number | 'unknown',
  target: number | 'unknown',
  comparator: '>=' | '<=' | 'rule-dependent',
  /**
   * Steps still missing (`>=`) or steps over the limit (`<=`); 0 when met.
   *
   * For global parameters a step is one track step (2 °C for temperature).
   */
  gap: number | 'unknown',
  /**
   * - `met` / `unmet`: established from observed values with the engine's rule.
   * - `conditional`: computed, but a card or option in play may change the rule (see `assumptions`).
   * - `unsupported`: this kind of requirement is not evaluated.
   */
  status: 'met' | 'unmet' | 'conditional' | 'unsupported',
  /** True for an unmet maximum requirement: global parameters never go down, so it cannot be met again. */
  permanentlyUnmet?: boolean,
  assumptions?: ReadonlyArray<string>,
  evidence: ReadonlyArray<Evidence>,
};

/** Where a card of the synergy graph is. */
export type CardZone = 'played' | 'hand' | 'offered';

export const SYNERGY_KINDS = ['UNLOCKS', 'DISCOUNTS', 'PRODUCES_FOR', 'FEEDS_RESOURCE', 'AMPLIFIES', 'SCORING', 'CONFLICTS_WITH'] as const;
export type SynergyKind = typeof SYNERGY_KINDS[number];

/**
 * A directed relation "A helps (or hurts) B" backed by an actual effect or requirement, never by a
 * shared tag alone.
 */
export type SynergyEdge = {
  from: CardName,
  to: CardName,
  kind: SynergyKind,
  /** Plain-English reason, built from the facts below. */
  why: string,
  /** Size of the effect where it is a number (M€ discount, steps of a requirement, VP), else absent. */
  amount?: number,
  /** UNLOCKS: true when A alone closes the requirement gap. */
  completes?: boolean,
  /** DISCOUNTS from a played card: the discount is already in B's current cost. */
  alreadyApplied?: boolean,
  /** CONFLICTS_WITH: the order that avoids the conflict, when there is one. */
  playFirst?: CardName,
  /** For requirement edges: index of B's requirement concerned. */
  requirementIndex?: number,
  support: Support,
};

export type SynergyNode = {
  name: CardName,
  zone: CardZone,
  /** Coverage of the card's effects (see CoachMechanics). */
  mechanics: 'supported' | 'partial' | 'unsupported' | 'none' | 'not-in-catalog',
};

/** Relations between the cards a player has played, holds and is offered. */
export type SynergyGraph = {
  nodes: ReadonlyArray<SynergyNode>,
  edges: ReadonlyArray<SynergyEdge>,
  /** Kinds of relations that are not produced yet, with the reason. */
  notProduced: ReadonlyArray<{kind: SynergyKind, reason: string}>,
  /** Cases inside the produced kinds that are not detected (so a missing edge is not a "no"). */
  limitations: ReadonlyArray<string>,
};

export const PLAN_GOALS = ['economy', 'unlock', 'engine', 'scoring', 'terraforming'] as const;
export type PlanGoal = typeof PLAN_GOALS[number];

/** One card of a candidate plan, in play order. */
export type PlanCard = {
  name: CardName,
  zone: CardZone,
  /**
   * - `legal-now`: the game offers this card to play right now (first card of the plan only).
   * - `conditional`: could be played later if the listed blockers are resolved (after earlier cards,
   *   after buying it, with more resources).
   * - `unknown`: a requirement or play condition of the card is not evaluated.
   */
  availability: 'legal-now' | 'conditional' | 'unknown',
  reasons: ReadonlyArray<string>,
  /** Cost when it is played in this plan (after the discounts of earlier cards of the plan), or unknown. */
  cost: number | 'unknown',
  /** M€ to buy the card first (offered cards only). */
  purchaseCost?: number,
};

/** A question that makes the player weigh the plan; `key` and `params` allow translation. */
export type PlanQuestion = {key: string, params: Readonly<Record<string, string>>, text: string};

/**
 * A short line of play (1–3 cards from hand or offer) with the relations that make it worth looking at.
 *
 * Not a recommendation: plans of different goals are shown side by side for the player to compare.
 */
export type CandidatePlan = {
  id: string,
  /** Main goal (from the strongest relation in the plan); `goals` lists all goals the plan touches. */
  goal: PlanGoal,
  goals: ReadonlyArray<PlanGoal>,
  cards: ReadonlyArray<PlanCard>,
  /** Relations inside the plan and from played cards to it. */
  links: ReadonlyArray<SynergyEdge>,
  /** Requirements and costs still unresolved, per card of the plan (`card` names it). */
  blockers: ReadonlyArray<RequirementGap & {card: CardName}>,
  payments: {
    /** M€ cost of playing the cards in this order (after in-plan discounts), or unknown. */
    play: number | 'unknown',
    /** M€ to buy offered cards first. */
    purchase: number,
  },
  support: Support,
  question: PlanQuestion,
};

/** Result of the plan search with its limits. */
export type CandidateSet = {
  candidates: ReadonlyArray<CandidatePlan>,
  /** Cards left out of every plan, with the reason. */
  discarded: ReadonlyArray<{cardName: CardName, reason: string}>,
  warnings: ReadonlyArray<string>,
  search: {
    /** Unplayed cards considered (hand and offer, after the pool limit). */
    poolSize: number,
    chainsExamined: number,
    /** True when a limit stopped the search early (see warnings). */
    truncated: boolean,
    elapsedMs: number,
  },
};
