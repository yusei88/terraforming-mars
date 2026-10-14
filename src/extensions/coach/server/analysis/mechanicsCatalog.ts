import {CardName} from '@/common/cards/CardName';
import {CardMechanics} from '../../common/CoachMechanics';
import {getCatalog} from '../cardCatalog';
import {extractMechanics} from './extractFeatures';

// Mechanics of every card of this build, extracted once from the catalog.

let cached: ReadonlyMap<CardName, CardMechanics> | undefined;

function all(): ReadonlyMap<CardName, CardMechanics> {
  if (cached === undefined) {
    cached = new Map(getCatalog().cards.map((card) => [card.name, extractMechanics(card)]));
  }
  return cached;
}

/** Mechanics of one card, or undefined when the card is not in the catalog. */
export function mechanicsOf(name: CardName): CardMechanics | undefined {
  return all().get(name);
}

export function allMechanics(): ReadonlyArray<CardMechanics> {
  return Array.from(all().values());
}
