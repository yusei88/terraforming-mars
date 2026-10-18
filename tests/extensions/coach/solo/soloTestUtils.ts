import {Game} from '../../../../src/server/Game';
import {IPlayer} from '../../../../src/server/IPlayer';
import {CoachTracer} from '../../../../src/extensions/coach/server/coachTrace';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {CoachStateV1} from '../../../../src/extensions/coach/common/CoachState';
import {InputResponse} from '../../../../src/common/inputs/InputResponse';
import {Payment} from '../../../../src/common/inputs/Payment';
import {CardName} from '../../../../src/common/cards/CardName';
import {newCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {TestPlayer} from '../../../TestPlayer';
import {GameId, SpectatorId} from '../../../../src/common/Types';
import {CardType} from '../../../../src/common/cards/CardType';

// Helpers for the solo coach tests: a traced solo game driven through the same observer the
// PlayerInput route uses.

export function root(state: CoachStateV1) {
  if (state.choices.status !== 'awaiting-input') {
    throw new Error(`no question: ${state.choices.status}`);
  }
  return state.choices.root;
}

/* Answers through the tracer exactly like the PlayerInput route does. */
export function act(tracer: CoachTracer, player: IPlayer, response: InputResponse) {
  const done = tracer.observer.beforeInput(player, response, 1000)!;
  try {
    player.process(response);
  } catch (error) {
    done({accepted: false, error: String(error)});
    throw error;
  }
  done({accepted: true});
}

/**
 * A solo game after the initial choice: the first corporation and `buy` of the offered cards. With
 * `tracer` undefined the choice is not recorded (for tests that set up a hand before tracing).
 */
export function newSolo(tracer: CoachTracer | undefined, id: string, buy = 0, options: {undoOption?: boolean, soloTR?: boolean} = {}) {
  const player = TestPlayer.BLUE.newPlayer();
  const game = Game.newInstance(id as GameId, [player], player, `spectator-${id}` as SpectatorId, {undoOption: options.undoOption ?? true, soloTR: options.soloTR ?? false});
  const offer = root(projectCoachState(player));
  const corporation = offer.options![0].cards![0].name;
  const cards = offer.options![1].cards!.slice(0, buy).map((c) => c.name);
  const response: InputResponse = {type: 'initialCards', responses: [{type: 'card', cards: [corporation]}, {type: 'card', cards}]};
  if (tracer === undefined) {
    player.process(response);
  } else {
    act(tracer, player, response);
  }
  return {game, player, bought: cards};
}

/**
 * Replaces the hand and money, and asks for the next action again (a test position). Do it before the
 * tracer records anything: a change the history did not see is taken for a rollback.
 */
export function setHand(player: IPlayer, cards: ReadonlyArray<CardName>, megacredits: number) {
  player.cardsInHand.length = 0;
  player.cardsInHand.push(...cards.map((name) => newCard(name) as IProjectCard));
  player.megaCredits = megacredits;
  player.takeAction();
}

/** Removes the corporation from play (a test position without the corporation's own effects). */
export function withoutCorporation(player: IPlayer) {
  player.playedCards.set(...player.playedCards.asArray().filter((c) => c.type !== CardType.CORPORATION));
}

export function optionIndex(player: IPlayer, title: string): number {
  const index = root(projectCoachState(player)).options!.findIndex((o) => o.title === title);
  if (index < 0) {
    throw new Error(`no option ${title}`);
  }
  return index;
}

/** Plays a project card from hand, paying `payment` (M€ by default: the game's cost). */
export function play(tracer: CoachTracer, player: IPlayer, card: CardName, payment?: Partial<Payment>) {
  const menu = root(projectCoachState(player));
  const index = optionIndex(player, 'Play project card');
  const cost = menu.options![index].cards!.find((c) => c.name === card)?.calculatedCost;
  if (cost === undefined) {
    throw new Error(`${card} is not playable`);
  }
  act(tracer, player, {type: 'or', index, response: {type: 'projectCard', card, payment: Payment.of(payment ?? {megacredits: cost})}});
}

export function pass(tracer: CoachTracer, player: IPlayer) {
  act(tracer, player, {type: 'or', index: optionIndex(player, 'Pass for this generation'), response: {type: 'option'}});
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));
