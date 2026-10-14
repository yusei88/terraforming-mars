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
  kind: 'tag' | 'oxygen' | 'temperature' | 'oceans' | 'tr' | 'production' | 'greeneries' | 'cities' | 'other',
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
