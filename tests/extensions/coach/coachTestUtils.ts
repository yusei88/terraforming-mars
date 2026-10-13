import {expect} from 'chai';
import {IGame} from '../../../src/server/IGame';

/** Fails when any id that grants access (player, spectator, game) appears in `value`. */
export function expectNoSecretIds(value: unknown, game: IGame): void {
  const json = JSON.stringify(value);
  for (const player of game.players) {
    expect(json, `player id of ${player.color}`).does.not.contain(player.id);
  }
  expect(json, 'spectator id').does.not.contain(game.spectatorId);
  expect(json, 'game id').does.not.contain(`"${game.id}"`);
}

export {answer, SIMPLE_POLICY} from '../../../scripts/coach/autopilot';
export type {Policy} from '../../../scripts/coach/autopilot';
