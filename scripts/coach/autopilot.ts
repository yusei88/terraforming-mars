// Answers coach questions using only what CoachState offers (used by the tests and liveCheck.ts).
// If an answer can be built from `choices` alone, the paths and options are complete enough to act on.
import {CoachChoice, CoachStateV1} from '../../src/extensions/coach/common/CoachState';
import {InputResponse} from '../../src/common/inputs/InputResponse';
import {Payment} from '../../src/common/inputs/Payment';
import {CardName} from '../../src/common/cards/CardName';

/** Choices of an answer policy. */
export type Policy = {
  /** Picks the index of an `or` option. */
  pickOr(choice: CoachChoice, state: CoachStateV1): number,
  /** Picks the cards of a `card` question (`min`..`max`). */
  pickCards(choice: CoachChoice, state: CoachStateV1): Array<CardName>,
  /** Picks a card to play from a `projectCard` question, or undefined. */
  pickProjectCard?(choice: CoachChoice, state: CoachStateV1): CardName | undefined,
};

/** Policy: play the first affordable card, otherwise convert plants/heat, otherwise pass; buy nothing. */
export const SIMPLE_POLICY: Policy = {
  pickOr(choice, state) {
    const options = choice.options ?? [];
    const find = (predicate: (option: CoachChoice) => boolean) => options.findIndex(predicate);
    const affordable = find((option) => option.inputType === 'projectCard' &&
      (option.cards ?? []).some((card) => (card.calculatedCost ?? 0) <= state.me.resources.megacredits));
    const ordered = [
      affordable,
      find((option) => /plants into greenery/.test(option.title)),
      find((option) => /heat into temperature/.test(option.title)),
      find((option) => option.title === 'Pass for this generation'),
      find((option) => option.title === 'End Turn'),
    ];
    const index = ordered.find((i) => i >= 0);
    return index ?? choice.initialIndex ?? 0;
  },
  pickCards(choice) {
    return (choice.cards ?? []).slice(0, choice.min ?? 0).map((card) => card.name);
  },
  pickProjectCard(choice, state) {
    return (choice.cards ?? []).find((card) => (card.calculatedCost ?? 0) <= state.me.resources.megacredits)?.name;
  },
};

/** Builds an answer for `choice` using only what CoachState offers. Throws on unsupported nodes. */
export function answer(choice: CoachChoice, state: CoachStateV1, policy: Policy = SIMPLE_POLICY): InputResponse {
  switch (choice.inputType) {
  case 'or': {
    const index = policy.pickOr(choice, state);
    const option = choice.options?.[index];
    if (option === undefined) {
      throw new Error(`no option ${index} at ${choice.path}`);
    }
    return {type: 'or', index, response: answer(option, state, policy)};
  }
  case 'and':
    return {type: 'and', responses: (choice.options ?? []).map((option) => answer(option, state, policy))};
  case 'initialCards':
    return {type: 'initialCards', responses: (choice.options ?? []).map((option) => answer(option, state, policy))};
  case 'option':
    return {type: 'option'};
  case 'card':
    return {type: 'card', cards: policy.pickCards(choice, state)};
  case 'projectCard': {
    const card = policy.pickProjectCard?.(choice, state) ?? choice.cards?.[0]?.name;
    const cost = choice.cards?.find((c) => c.name === card)?.calculatedCost ?? 0;
    if (card === undefined) {
      throw new Error('no card to play');
    }
    return {type: 'projectCard', card, payment: Payment.of({megacredits: cost})};
  }
  case 'space':
    return {type: 'space', spaceId: (choice.spaces ?? [])[0]};
  case 'payment':
    return {type: 'payment', payment: Payment.of({megacredits: choice.amount ?? 0})};
  case 'player':
    return {type: 'player', player: (choice.players ?? [])[0]};
  case 'amount':
    return {type: 'amount', amount: choice.min ?? 0};
  case 'resource':
    return {type: 'resource', resource: (choice.include ?? ['megacredits'])[0] as 'megacredits'};
  default:
    throw new Error(`autopilot cannot answer ${choice.inputType} at ${choice.path}`);
  }
}
