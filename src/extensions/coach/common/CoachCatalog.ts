// Static card data for the strategy coach (schema `coach-catalog/1`).
//
// Derived at run time from the same card classes the game plays with, so it can never drift from the
// rules engine. Display metadata (texts for people) and machine-readable effects are kept apart, and
// every effect the declarative `Behavior` DSL does not describe is listed as bespoke code instead of
// being guessed.
import {CardName} from '@/common/cards/CardName';
import {CardType} from '@/common/cards/CardType';
import {Expansion, GameModule} from '@/common/cards/GameModule';
import {Tag} from '@/common/cards/Tag';
import {CardResource} from '@/common/CardResource';
import {CardDiscount} from '@/common/cards/Types';
import {CardRequirementDescriptor} from '@/common/cards/CardRequirementDescriptor';
import {CountableVictoryPoints} from '@/common/cards/CountableVictoryPoints';
import {Units} from '@/common/Units';

export const COACH_CATALOG_SCHEMA = 'coach-catalog/1';

/**
 * How completely the machine-readable fields describe one part of a card.
 *
 * - `none`: the card has no such part.
 * - `declarative`: fully described by the `Behavior` value given.
 * - `partial`: a `Behavior` value exists, but bespoke code adds to it (see `bespokeHooks`).
 * - `bespoke`: only bespoke code; nothing machine-readable. Read the display text.
 */
export type EffectCoverage = 'none' | 'declarative' | 'partial' | 'bespoke';

export type CoachCatalogCard = {
  name: CardName,
  module: GameModule,
  type: CardType,
  tags: ReadonlyArray<Tag>,
  /** Printed cost (project cards). */
  cost?: number,
  requirements: ReadonlyArray<CardRequirementDescriptor>,
  /** Printed VP: a number, a per-resource/per-tag rule, or `special` (computed by bespoke code). */
  victoryPoints?: number | 'special' | CountableVictoryPoints,
  resourceType?: CardResource,
  cardDiscount?: CardDiscount | ReadonlyArray<CardDiscount>,
  startingMegaCredits?: number,
  /** Corporations: price of one project card in the research phase. */
  cardCost?: number,
  compatibility: ReadonlyArray<Expansion>,
  /** Machine-readable effects. */
  effects: {
    /** What happens when the card is played (Behavior DSL). */
    onPlay?: unknown,
    /** The blue card action (Behavior DSL). */
    action?: unknown,
    /** Corporations: the first action printed on the card (Behavior DSL). */
    firstAction?: unknown,
    /** Production printed in the production box, when it is a fixed amount. */
    productionBox?: Units,
    /**
     * Rule effects declared as card properties instead of `Behavior` (plain data).
     *
     * `globalParameterRequirementBonus`: requirement steps the owner may ignore (`nextCardOnly` for one card).
     * `tr`: where the card's TR comes from. `protectedResources`: resources here cannot be removed by others.
     * `reserveUnits`: units the card needs left over after payment. `tilesBuilt`: tiles the card places.
     */
    staticEffects: {
      globalParameterRequirementBonus?: unknown,
      tr?: unknown,
      protectedResources?: boolean,
      adjacencyBonus?: unknown,
      reserveUnits?: Partial<Units>,
      tilesBuilt?: ReadonlyArray<string>,
    },
    playCoverage: EffectCoverage,
    actionCoverage: EffectCoverage,
    /**
     * Rule hooks the card implements in code (`onCardPlayed`, `getCardDiscount`, `bespokePlay`, …).
     *
     * Their effect is not machine-readable; a coach must not infer it from the name.
     */
    bespokeHooks: ReadonlyArray<string>,
    hasAction: boolean,
  },
  /** Texts for people. Not a source for automatic reasoning. */
  display: {
    cardNumber?: string,
    description?: string,
  },
};

export type CoachCatalog = {
  schemaVersion: typeof COACH_CATALOG_SCHEMA,
  /** Hash of the catalog content; CoachState snapshots name it in `catalogVersion`. */
  catalogVersion: string,
  cards: ReadonlyArray<CoachCatalogCard>,
};
