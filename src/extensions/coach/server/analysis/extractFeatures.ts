import {CoachCatalogCard} from '../../common/CoachCatalog';
import {CardMechanics, EffectAtom, EffectSource, MechanicsSupport, RequirementSpec, UnmodeledEffect} from '../../common/CoachMechanics';
import {Resource} from '@/common/Resource';
import {Tag} from '@/common/cards/Tag';
import {CardRequirementDescriptor} from '@/common/cards/CardRequirementDescriptor';
import {CardDiscount} from '@/common/cards/Types';

// Turns the catalog entry of a card into EffectAtoms (fixed numbers) and UnmodeledEffects (everything
// else, with a reason). Pure: reads only the catalog entry. A key this version does not recognize is
// reported as `unknown-key`, so new cards can never be silently counted as fully understood.

const RESOURCES: ReadonlyArray<Resource> = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

// Hooks that only restrict whether or where a card can be played. They make requirements incomplete
// (see `requirements`), not effect totals.
const PLAY_CONDITION_HOOKS: ReadonlySet<string> = new Set(['bespokeCanPlay', 'canPlay']);
// Hooks that belong to tile placement, already reported with the tile itself.
const PLACEMENT_HOOKS: ReadonlySet<string> = new Set(['getAvailableSpaces', 'spaceSelected', 'getTileType', 'getAdjacencyBonus', 'title']);

type Collector = {atoms: Array<EffectAtom>, unmodeled: Array<UnmodeledEffect>};

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function units(collector: Collector, source: EffectSource, key: 'stock' | 'production' | 'spend', value: Record<string, unknown>) {
  for (const [resource, amount] of Object.entries(value)) {
    if (key === 'spend' && (resource === 'canUseSteel' || resource === 'canUseTitanium')) {
      if (amount === true) {
        collector.unmodeled.push({source, kind: 'conditional-cost', key: `spend.${resource}`, reason: 'the cost may be paid with steel or titanium instead'});
      }
      continue;
    }
    if (!(RESOURCES as ReadonlyArray<string>).includes(resource)) {
      collector.unmodeled.push({source, kind: 'other', key: `${key}.${resource}`, reason: `${key} of ${resource} (not a standard resource)`});
      continue;
    }
    if (isNumber(amount)) {
      if (amount !== 0) {
        collector.atoms.push({kind: key, source, resource: resource as Resource, amount});
      }
    } else {
      collector.unmodeled.push({source, kind: 'countable', key: `${key}.${resource}`, reason: 'the amount is given by a formula'});
    }
  }
}

function behavior(collector: Collector, source: EffectSource, value: unknown) {
  if (value === undefined || value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    switch (key) {
    case 'stock':
    case 'production':
    case 'spend':
      units(collector, source, key, item as Record<string, unknown>);
      break;
    case 'tr':
      if (isNumber(item)) {
        collector.atoms.push({kind: 'tr', source, amount: item});
      } else {
        collector.unmodeled.push({source, kind: 'countable', key, reason: 'the TR amount is given by a formula'});
      }
      break;
    case 'global':
      for (const [parameter, steps] of Object.entries(item as Record<string, unknown>)) {
        if ((parameter === 'temperature' || parameter === 'oxygen') && isNumber(steps)) {
          collector.atoms.push({kind: 'global', source, parameter, steps});
        } else {
          collector.unmodeled.push({source, kind: 'other', key: `global.${parameter}`, reason: `raises ${parameter} (not modeled)`});
        }
      }
      break;
    case 'drawCard':
      if (isNumber(item)) {
        collector.atoms.push({kind: 'drawCard', source, count: item});
      } else {
        const draw = item as {count?: unknown, keep?: unknown, pay?: unknown, tag?: unknown, type?: unknown, resource?: unknown};
        if (draw.pay === true) {
          collector.unmodeled.push({source, kind: 'conditional-cost', key, reason: 'drawn cards are kept only if paid for'});
        } else if (draw.keep !== undefined || draw.tag !== undefined || draw.type !== undefined || draw.resource !== undefined) {
          collector.unmodeled.push({source, kind: 'choice', key, reason: 'some drawn cards are discarded'});
        } else if (isNumber(draw.count)) {
          collector.atoms.push({kind: 'drawCard', source, count: draw.count});
        } else {
          collector.unmodeled.push({source, kind: 'countable', key, reason: 'the number of cards is given by a formula'});
        }
      }
      break;
    case 'addResources':
      if (isNumber(item)) {
        collector.atoms.push({kind: 'addResourcesHere', source, count: item});
      } else {
        collector.unmodeled.push({source, kind: 'countable', key, reason: 'the number of resources is given by a formula'});
      }
      break;
    case 'steelValue':
    case 'titanumValue':
      if (isNumber(item)) {
        collector.atoms.push({kind: 'alloyValue', source, resource: key === 'steelValue' ? 'steel' : 'titanium', amount: item});
      }
      break;
    case 'addResourcesToAnyCard':
    case 'removeResourcesFromAnyCard':
    case 'decreaseAnyProduction':
    case 'removeAnyPlants':
      collector.unmodeled.push({source, kind: 'target-choice', key, reason: 'the target card or player is chosen when played'});
      break;
    case 'city':
    case 'greenery':
    case 'ocean':
    case 'tile':
      collector.unmodeled.push({source, kind: 'tile-placement', key, reason: 'a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled'});
      break;
    case 'or':
      collector.unmodeled.push({source, kind: 'choice', key, reason: 'the player chooses one of several effects'});
      break;
    case 'greeneryDiscount':
      collector.unmodeled.push({source, kind: 'other', key, reason: 'greeneries cost fewer plants (not modeled)'});
      break;
    case 'text':
    case 'title':
    case 'log':
      break;
    default:
      collector.unmodeled.push({source, kind: 'unknown-key', key, reason: `behavior key '${key}' is not known to the analysis`});
    }
  }
}

function victoryPoints(collector: Collector, card: CoachCatalogCard) {
  const vp = card.victoryPoints;
  if (vp === undefined) {
    return;
  }
  if (isNumber(vp)) {
    collector.atoms.push({kind: 'victoryPoints', source: 'victoryPoints', amount: vp});
    return;
  }
  if (vp === 'special') {
    collector.unmodeled.push({source: 'victoryPoints', kind: 'special-vp', key: 'victoryPoints', reason: 'victory points are computed by card code'});
    return;
  }
  const countable = vp as Record<string, unknown>;
  const keys = Object.keys(countable).filter((key) => key !== 'per' && key !== 'each');
  if (keys.length === 1 && keys[0] === 'resourcesHere') {
    const per = isNumber(countable.per) ? countable.per : 1;
    const points = isNumber(countable.each) ? countable.each : 1;
    collector.atoms.push({kind: 'victoryPointsPerResource', source: 'victoryPoints', points, per});
    return;
  }
  collector.unmodeled.push({source: 'victoryPoints', kind: 'countable', key: 'victoryPoints', reason: `victory points depend on ${keys.join(', ')}`});
}

function corporation(collector: Collector, card: CoachCatalogCard) {
  if (card.type !== 'corporation') {
    return;
  }
  if (isNumber(card.startingMegaCredits)) {
    collector.atoms.push({kind: 'startingMegaCredits', source: 'onPlay', amount: card.startingMegaCredits});
  }
  if (isNumber(card.cardCost)) {
    collector.atoms.push({kind: 'researchCardCost', source: 'static', amount: card.cardCost});
  }
}

function staticEffects(collector: Collector, card: CoachCatalogCard) {
  const discounts: ReadonlyArray<CardDiscount> = card.cardDiscount === undefined ? [] : Array.isArray(card.cardDiscount) ? card.cardDiscount : [card.cardDiscount as CardDiscount];
  for (const discount of discounts) {
    collector.atoms.push({kind: 'cardDiscount', source: 'static', tag: discount.tag, amount: discount.amount, per: discount.per ?? 'tag'});
  }
  const statics = card.effects.staticEffects;
  const bonus = statics.globalParameterRequirementBonus as {steps?: unknown, nextCardOnly?: unknown, parameter?: unknown} | undefined;
  if (bonus !== undefined) {
    if (bonus.parameter === undefined && isNumber(bonus.steps)) {
      collector.atoms.push({kind: 'requirementBonus', source: 'static', steps: bonus.steps, nextCardOnly: bonus.nextCardOnly === true});
    } else {
      collector.unmodeled.push({source: 'static', kind: 'other', key: 'globalParameterRequirementBonus', reason: 'requirement bonus for one parameter only'});
    }
  }
  if (statics.protectedResources === true) {
    collector.unmodeled.push({source: 'static', kind: 'other', key: 'protectedResources', reason: 'resources on this card cannot be removed by others'});
  }
  if (statics.reserveUnits !== undefined) {
    collector.unmodeled.push({source: 'static', kind: 'conditional-cost', key: 'reserveUnits', reason: 'resources must remain after paying for the card'});
  }
}

function hooks(collector: Collector, card: CoachCatalogCard) {
  for (const hook of card.effects.bespokeHooks) {
    if (PLAY_CONDITION_HOOKS.has(hook) || PLACEMENT_HOOKS.has(hook)) {
      continue;
    }
    collector.unmodeled.push({source: 'static', kind: 'bespoke-code', key: hook, reason: `card code '${hook}' changes what the card does`});
  }
}

/** Normalizes the catalog requirements; anything not evaluated is an `unsupported` spec. */
export function requirementSpecs(card: CoachCatalogCard): Array<RequirementSpec> {
  const specs = card.requirements.map((descriptor: CardRequirementDescriptor): RequirementSpec => {
    const max = descriptor.max === true;
    const all = descriptor.all === true;
    if (descriptor.nextTo === true) {
      return {kind: 'unsupported', text: 'next to a tile'};
    }
    if (descriptor.tag !== undefined) {
      return {kind: 'tag', tag: descriptor.tag as Tag, count: descriptor.count ?? 1, max, all};
    }
    for (const parameter of ['temperature', 'oxygen', 'oceans'] as const) {
      const value = descriptor[parameter];
      if (isNumber(value)) {
        return {kind: 'global', parameter, count: value, max};
      }
    }
    if (descriptor.production !== undefined) {
      return {kind: 'production', resource: descriptor.production, count: descriptor.count ?? 1};
    }
    if (isNumber(descriptor.tr)) {
      return {kind: 'tr', count: descriptor.tr, max};
    }
    if (isNumber(descriptor.greeneries)) {
      return {kind: 'tiles', tile: 'greeneries', count: descriptor.greeneries, max, all};
    }
    if (isNumber(descriptor.cities)) {
      return {kind: 'tiles', tile: 'cities', count: descriptor.cities, max, all};
    }
    return {kind: 'unsupported', text: JSON.stringify(descriptor)};
  });
  if (card.effects.bespokeHooks.some((hook) => PLAY_CONDITION_HOOKS.has(hook))) {
    specs.push({kind: 'unsupported', text: 'card-specific play condition (bespokeCanPlay)'});
  }
  return specs;
}

/** Mechanics of one card: atoms, unmodeled effects with reasons, requirement specs, support level. */
export function extractMechanics(card: CoachCatalogCard): CardMechanics {
  const collector: Collector = {atoms: [], unmodeled: []};
  behavior(collector, 'onPlay', card.effects.onPlay);
  behavior(collector, 'action', card.effects.action);
  behavior(collector, 'firstAction', card.effects.firstAction);
  if (card.effects.hasAction && card.effects.action === undefined && !card.effects.bespokeHooks.includes('action')) {
    collector.unmodeled.push({source: 'action', kind: 'bespoke-code', key: 'action', reason: 'the action is implemented in card code'});
  }
  if (card.effects.productionBox !== undefined && card.effects.onPlay === undefined) {
    collector.unmodeled.push({source: 'onPlay', kind: 'other', key: 'productionBox', reason: 'production box without Behavior'});
  }
  victoryPoints(collector, card);
  corporation(collector, card);
  staticEffects(collector, card);
  hooks(collector, card);
  const {atoms, unmodeled} = collector;
  let support: MechanicsSupport;
  if (atoms.length === 0 && unmodeled.length === 0) {
    support = 'none';
  } else if (unmodeled.length === 0) {
    support = 'supported';
  } else if (atoms.length === 0) {
    support = 'unsupported';
  } else {
    support = 'partial';
  }
  return {name: card.name, atoms, unmodeled, requirements: requirementSpecs(card), support};
}
