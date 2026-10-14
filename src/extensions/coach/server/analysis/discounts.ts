import {CoachCardInstance, CoachStateV1} from '../../common/CoachState';
import {Evidence, Support} from '../../common/CoachAnalysis';
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {catalogCard} from '../cardCatalog';
import {mechanicsOf} from './mechanicsCatalog';

// Cost of a card after one more discount card is in play, with the engine's rule (Player.getCardCost):
// the cost the game computes now minus the new card's discount, never below 0. A per-tag discount counts
// the target card's own tags (wild tags do not count); a per-card discount applies once.

/** Discount `discountCard` gives on `target`, or undefined when it cannot be computed exactly. */
export function discountOn(discountCard: CardName, target: CardName): {amount: number, evidence: Array<Evidence>} | undefined {
  const mechanics = mechanicsOf(discountCard);
  const targetCard = catalogCard(target);
  if (mechanics === undefined || targetCard === undefined) {
    return undefined;
  }
  // Only getCardDiscount changes project card costs (getStandardProjectDiscount is for standard projects).
  if (mechanics.unmodeled.some((u) => u.key === 'getCardDiscount')) {
    return undefined;
  }
  let amount = 0;
  for (const atom of mechanics.atoms) {
    if (atom.kind !== 'cardDiscount') {
      continue;
    }
    if (atom.tag === undefined) {
      amount += atom.amount;
      continue;
    }
    const count = targetCard.tags.filter((tag) => tag === atom.tag).length;
    amount += atom.per === 'card' ? (count > 0 ? atom.amount : 0) : atom.amount * count;
  }
  return {
    amount,
    evidence: [
      {kind: 'catalog', fieldPath: 'cardDiscount', cardName: discountCard},
      {kind: 'catalog', fieldPath: 'tags', cardName: target},
    ],
  };
}

export type CostPrediction = {
  cost: number | 'unknown',
  support: Support,
};

/**
 * Cost of `target` (a card with an engine-computed cost in the snapshot) once `discountCard` is played.
 *
 * Exact when the current cost is known and the discount is fully declarative; Habitat Marte (Mars tags
 * counted as science) makes it conditional.
 */
export function costAfterDiscount(state: CoachStateV1, target: CoachCardInstance, targetPath: string, discountCard: CardName): CostPrediction {
  if (target.calculatedCost === undefined) {
    return {cost: 'unknown', support: {level: 'unsupported', reason: 'the current cost of the card is not known'}};
  }
  const discount = discountOn(discountCard, target.name);
  if (discount === undefined) {
    return {cost: 'unknown', support: {level: 'unsupported', reason: `the discount of ${discountCard} is implemented in card code`}};
  }
  const cost = Math.max(0, target.calculatedCost - discount.amount);
  const evidence: Array<Evidence> = [{kind: 'state', fieldPath: `${targetPath}.calculatedCost`, cardName: target.name, stateFingerprint: state.fingerprint}, ...discount.evidence];
  const habitatMarte = state.me.tableau.some((c) => c.name === CardName.HABITAT_MARTE);
  const mechanics = mechanicsOf(discountCard);
  if (habitatMarte && mechanics?.atoms.some((a) => a.kind === 'cardDiscount' && a.tag === Tag.SCIENCE)) {
    return {cost, support: {level: 'conditional', assumptions: ['Habitat Marte counts Mars tags as science tags'], evidence}};
  }
  return {cost, support: {level: 'verified', evidence}};
}
