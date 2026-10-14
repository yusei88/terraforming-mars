import {createHash} from 'crypto';
import {ALL_MODULE_MANIFESTS} from '@/server/cards/AllManifests';
import {CardManifest} from '@/server/cards/ModuleManifest';
import {ICard, isIActionCard} from '@/server/cards/ICard';
import {Card} from '@/server/cards/Card';
import {ActionCard} from '@/server/cards/ActionCard';
import {ActiveCorporationCard, CorporationCard} from '@/server/cards/corporation/CorporationCard';
import {PreludeCard} from '@/server/cards/prelude/PreludeCard';
import {CeoCard} from '@/server/cards/ceos/CeoCard';
import {StandardProjectCard} from '@/server/cards/StandardProjectCard';
import {StandardActionCard} from '@/server/cards/StandardActionCard';
import {isICorporationCard} from '@/server/cards/corporation/ICorporationCard';
import {isPreludeCard} from '@/server/cards/prelude/IPreludeCard';
import {CardType} from '@/common/cards/CardType';
import {CardName} from '@/common/cards/CardName';
import {Expansion, GameModule} from '@/common/cards/GameModule';
import {Units} from '@/common/Units';
import {TileType} from '@/common/TileType';
import {asArray} from '@/common/utils/utils';
import {OneOrArray} from '@/common/utils/types';
import {COACH_CATALOG_SCHEMA, CoachCatalog, CoachCatalogCard, EffectCoverage} from '../common/CoachCatalog';

// Classes that implement rules generically (from `behavior` / `action`); their methods are not card-specific.
const FRAMEWORK_PROTOTYPES: ReadonlySet<object> = new Set([
  Card.prototype,
  ActionCard.prototype,
  CorporationCard.prototype,
  ActiveCorporationCard.prototype,
  PreludeCard.prototype,
  CeoCard.prototype,
  StandardProjectCard.prototype,
  StandardActionCard.prototype,
  Object.prototype,
]);

// Hooks that change what happens when the card is played.
const PLAY_HOOKS: ReadonlyArray<string> = ['play', 'bespokePlay', 'bespokePlayBefore', 'initialAction'];
// Hooks that change what the blue card action does.
const ACTION_HOOKS: ReadonlyArray<string> = ['action', 'bespokeAction'];

/** Names of the card-specific methods of `card`, sorted (inherited framework methods excluded). */
export function bespokeHooks(card: ICard): Array<string> {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(card);
  while (proto !== null && !FRAMEWORK_PROTOTYPES.has(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor !== undefined && typeof descriptor.value === 'function') {
        names.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return Array.from(names).sort();
}

function coverage(declarative: unknown, hooks: ReadonlyArray<string>, relevant: ReadonlyArray<string>): EffectCoverage {
  const bespoke = hooks.some((hook) => relevant.includes(hook));
  if (declarative !== undefined) {
    return bespoke ? 'partial' : 'declarative';
  }
  return bespoke ? 'bespoke' : 'none';
}

function descriptionText(card: ICard): string | undefined {
  const description = card.metadata.description;
  if (description === undefined) {
    return undefined;
  }
  return typeof description === 'string' ? description : description.text;
}

/** Copies `value` as plain JSON data (Behavior values are plain data). */
function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Converts one card class into its catalog entry. */
export function toCatalogCard(module: GameModule, card: ICard, compatibility: OneOrArray<Expansion> | undefined): CoachCatalogCard {
  const hooks = bespokeHooks(card);
  const hasAction = isIActionCard(card);
  const production = card.behavior?.production;
  const actionBehavior = card instanceof Card ? card.actionBehavior : undefined;
  const staticEffects: CoachCatalogCard['effects']['staticEffects'] = {};
  if (card instanceof Card) {
    staticEffects.globalParameterRequirementBonus = plain(card.globalParameterRequirementBonus);
    staticEffects.tr = plain(card.tr);
    staticEffects.protectedResources = card.protectedResources;
    staticEffects.adjacencyBonus = plain(card.adjacencyBonus);
    if (!Units.isEmpty(card.reserveUnits)) {
      staticEffects.reserveUnits = card.reserveUnits;
    }
    if (card.tilesBuilt.length > 0) {
      staticEffects.tilesBuilt = card.tilesBuilt.map((tile) => TileType[tile] ?? String(tile));
    }
  }
  const firstAction = isICorporationCard(card) ? card.firstAction : undefined;
  const effects: CoachCatalogCard['effects'] = {
    onPlay: plain(card.behavior),
    action: plain(actionBehavior),
    firstAction: plain(firstAction),
    playCoverage: coverage(card.behavior ?? firstAction, hooks, PLAY_HOOKS),
    actionCoverage: hasAction ? coverage(actionBehavior, hooks, ACTION_HOOKS) : 'none',
    staticEffects,
    bespokeHooks: hooks,
    hasAction,
  };
  if (Units.isUnits(production)) {
    effects.productionBox = production;
  }
  const entry: CoachCatalogCard = {
    name: card.name,
    module,
    type: card.type,
    tags: card.tags,
    cost: card.cost,
    requirements: card.requirements,
    victoryPoints: card.victoryPoints,
    resourceType: card.resourceType,
    cardDiscount: card.cardDiscount,
    startingMegaCredits: isPreludeCard(card) || isICorporationCard(card) ? card.startingMegaCredits : undefined,
    cardCost: isICorporationCard(card) ? card.cardCost : undefined,
    compatibility: compatibility === undefined ? [] : asArray(compatibility),
    effects,
    display: {
      cardNumber: card.metadata.cardNumber,
      description: descriptionText(card),
    },
  };
  return JSON.parse(JSON.stringify(entry));
}

/** Builds the catalog of every card known to this build (all modules; proxies excluded). */
export function buildCatalog(): CoachCatalog {
  const cards: Array<CoachCatalogCard> = [];
  for (const manifest of ALL_MODULE_MANIFESTS) {
    const decks: ReadonlyArray<CardManifest<ICard>> = [
      manifest.corporationCards, manifest.projectCards, manifest.preludeCards, manifest.ceoCards,
      manifest.standardProjects, manifest.standardActions,
    ];
    for (const deck of decks) {
      for (const factory of CardManifest.values(deck)) {
        const card = new factory.Factory();
        if (card.type === CardType.PROXY) {
          continue;
        }
        cards.push(toCatalogCard(manifest.module, card, factory.compatibility));
      }
    }
  }
  const catalogVersion = createHash('sha256').update(JSON.stringify(cards)).digest('hex').slice(0, 16);
  return {schemaVersion: COACH_CATALOG_SCHEMA, catalogVersion, cards};
}

let cached: {catalog: CoachCatalog, byName: ReadonlyMap<CardName, CoachCatalogCard>, json: string} | undefined;

function ensure() {
  if (cached === undefined) {
    const catalog = buildCatalog();
    cached = {catalog, byName: new Map(catalog.cards.map((card) => [card.name, card])), json: JSON.stringify(catalog)};
  }
  return cached;
}

/** The catalog of this build, built once per process. */
export function getCatalog(): CoachCatalog {
  return ensure().catalog;
}

/** The catalog as a JSON string (cached). */
export function getCatalogJson(): string {
  return ensure().json;
}

export function catalogVersion(): string {
  return ensure().catalog.catalogVersion;
}

export function isInCatalog(name: CardName): boolean {
  return ensure().byName.has(name);
}

export function catalogCard(name: CardName): CoachCatalogCard | undefined {
  return ensure().byName.get(name);
}
