import {CardName} from '@/common/cards/CardName';
import {CoachStateV1} from '../../common/CoachState';
import {UpcomingHint} from '../../common/CoachReflection';
import {costAfterDiscount} from '../analysis/discounts';
import {mechanicsOf} from '../analysis/mechanicsCatalog';
import {canPayInOrder, findingId, playableCards} from './evidence';

// Hints before acting (P3-SOLO-3, off unless the player turns them on): two cards the game offers to play
// now where playing one first lowers the other's cost, both payable in that order. The same checks as
// the play-order evaluation, on the position now. The hint only says that the order matters; the cards
// are shown when the player asks.

export function upcomingHints(state: CoachStateV1): Array<UpcomingHint> {
  if (state.game.mode !== 'solo' || state.choices.status !== 'awaiting-input') {
    return [];
  }
  const offered = playableCards(state);
  const hints: Array<UpcomingHint> = [];
  for (const target of offered) {
    for (const discount of offered) {
      if (target.card.name === discount.card.name || target.card.calculatedCost === undefined || discount.card.calculatedCost === undefined) {
        continue;
      }
      const after = costAfterDiscount(state, target.card, target.path, discount.card.name);
      if (after.cost === 'unknown' || after.cost >= target.card.calculatedCost || after.support.level !== 'verified') {
        continue;
      }
      const risky = mechanicsOf(target.card.name)?.requirements.some((r) => r.kind === 'unsupported' || ('max' in r && r.max)) ?? true;
      if (risky || canPayInOrder(state, {card: discount.card.name, cost: discount.card.calculatedCost}, {card: target.card.name as CardName, cost: after.cost}) !== true) {
        continue;
      }
      hints.push({id: findingId('play-order-discount', [], `${state.stateKey}|${discount.card.name}|${target.card.name}`), kind: 'play-order-discount', cards: [discount.card.name, target.card.name]});
    }
  }
  return hints.slice(0, 1);
}
