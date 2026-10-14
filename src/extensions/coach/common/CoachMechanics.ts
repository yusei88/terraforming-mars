// Machine-checkable card effects for the coach analysis (Phase 2, `coach-mechanics/1`).
//
// An EffectAtom is one effect whose amount is a fixed number read from the card class. Anything the
// analysis cannot compute exactly (choices, formulas, targets, card-specific code) is an UnmodeledEffect
// with a reason, never a guessed atom. A plan may only add up atoms.
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {Resource} from '@/common/Resource';

export const COACH_MECHANICS_SCHEMA = 'coach-mechanics/1';

/** Where on the card an effect comes from. */
export type EffectSource = 'onPlay' | 'action' | 'firstAction' | 'static' | 'victoryPoints';

export type EffectAtom =
  /** Gain (or lose, when negative) resources in stock. */
  {kind: 'stock', source: EffectSource, resource: Resource, amount: number} |
  /** Raise (or lower) production. */
  {kind: 'production', source: EffectSource, resource: Resource, amount: number} |
  /** Pay resources (the cost of a blue card action). */
  {kind: 'spend', source: EffectSource, resource: Resource, amount: number} |
  /** Raise terraform rating directly (not through a global parameter). */
  {kind: 'tr', source: EffectSource, amount: number} |
  /**
   * Raise a global parameter by `steps` steps.
   *
   * TR, bonuses and the maximum are applied by the game; the analysis must model them separately.
   */
  {kind: 'global', source: EffectSource, parameter: 'temperature' | 'oxygen', steps: number} |
  /** Draw cards (their content is unknown). */
  {kind: 'drawCard', source: EffectSource, count: number} |
  /** Add resources to this card. */
  {kind: 'addResourcesHere', source: EffectSource, count: number} |
  /** Discount on later project cards (all cards when `tag` is absent). */
  {kind: 'cardDiscount', source: EffectSource, tag?: Tag, amount: number, per: 'card' | 'tag'} |
  /** Requirement steps ignored for global parameters (`nextCardOnly`: only for the next card played). */
  {kind: 'requirementBonus', source: EffectSource, steps: number, nextCardOnly: boolean} |
  /** Raise the value of steel or titanium when paying. */
  {kind: 'alloyValue', source: EffectSource, resource: 'steel' | 'titanium', amount: number} |
  /** Corporations: M€ received when the corporation is chosen. */
  {kind: 'startingMegaCredits', source: EffectSource, amount: number} |
  /** Corporations: price of one project card in the research phase (normally 3). */
  {kind: 'researchCardCost', source: EffectSource, amount: number} |
  /** Fixed victory points printed on the card. */
  {kind: 'victoryPoints', source: EffectSource, amount: number} |
  /** Victory points per `per` resources on this card (rounded down). */
  {kind: 'victoryPointsPerResource', source: EffectSource, points: number, per: number};

/** Kinds of effects the analysis knows to exist but does not compute. */
export const UNMODELED_KINDS = [
  'choice',             // `or` behaviors: the player picks one
  'countable',          // amounts given by a formula (per tag, per city, …)
  'target-choice',      // resources or production taken from / given to a chosen card or player
  'tile-placement',     // a tile must be placed: legal spaces, adjacency and bonuses are not modeled
  'bespoke-code',       // card-specific code (bespokeHooks) changes the effect
  'conditional-cost',   // optional payment (e.g. pay to keep drawn cards)
  'special-vp',         // victory points computed by card code
  'unknown-key',        // a Behavior key this version does not know
  'other',
] as const;
export type UnmodeledKind = typeof UNMODELED_KINDS[number];

export type UnmodeledEffect = {
  source: EffectSource,
  kind: UnmodeledKind,
  /** The Behavior key or hook name. */
  key: string,
  reason: string,
};

/**
 * How completely the analysis covers one card.
 *
 * - `supported`: every effect of the card is an atom; nothing unmodeled.
 * - `partial`: some atoms, some unmodeled effects. Totals over this card are not exact.
 * - `unsupported`: no effect could be turned into an atom.
 * - `none`: the card has no effect at all (nothing to model).
 */
export type MechanicsSupport = 'supported' | 'partial' | 'unsupported' | 'none';

/** A requirement the analysis can or cannot evaluate. */
export type RequirementSpec =
  {kind: 'tag', tag: Tag, count: number, max: boolean, all: boolean} |
  {kind: 'global', parameter: 'temperature' | 'oxygen' | 'oceans', count: number, max: boolean} |
  {kind: 'production', resource: Resource, count: number} |
  {kind: 'tr', count: number, max: boolean} |
  {kind: 'tiles', tile: 'greeneries' | 'cities', count: number, max: boolean, all: boolean} |
  {kind: 'unsupported', text: string};

export type CardMechanics = {
  name: CardName,
  atoms: ReadonlyArray<EffectAtom>,
  unmodeled: ReadonlyArray<UnmodeledEffect>,
  requirements: ReadonlyArray<RequirementSpec>,
  support: MechanicsSupport,
};
