// Builds the evaluation positions of the coach chat (Phase 3, Iteration 0) from test games played in
// this process: deterministic seeds, no database, no real player. Each fixture holds the player's
// CoachState (without board spaces) and the analysis for horizon 3.
//
//   npx tsx tests/extensions/coach/chat/makeFixtures.ts [outDir]
import '../../../testing/setup';
import * as fs from 'fs';
import * as path from 'path';
import {Game} from '../../../../src/server/Game';
import {IPlayer} from '../../../../src/server/IPlayer';
import {Phase} from '../../../../src/common/Phase';
import {TestPlayer} from '../../../TestPlayer';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {analyze} from '../../../../src/extensions/coach/server/analysis/engine';
import {CoachStateV1} from '../../../../src/extensions/coach/common/CoachState';
import {CoachAnalysisV1} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {answer, Policy, SIMPLE_POLICY} from '../../../../scripts/coach/autopilot';
import {GameId, SpectatorId} from '../../../../src/common/Types';

export type ChatFixture = {
  id: string,
  description: string,
  tags: {
    mode: 'solo' | 'multiplayer', generation: number, phase: string, planCount: number, goals: Array<string>,
    truncated: boolean, incompleteForecast: boolean, unknownAvailability: boolean, legalNow: boolean,
  },
  state: CoachStateV1,
  analysis: CoachAnalysisV1,
};

/** Buys up to three of the cheapest offered cards while keeping 10 M€, plays the first affordable card. */
const BUYING: Policy = {
  ...SIMPLE_POLICY,
  pickCards(choice, state) {
    if (/buy/i.test(choice.title)) {
      const budget = Math.max(0, state.me.resources.megacredits - 10);
      const count = Math.min(3, choice.max ?? 0, Math.floor(budget / Math.max(1, state.me.cardCost)));
      return [...(choice.cards ?? [])].sort((a, b) => (a.calculatedCost ?? 0) - (b.calculatedCost ?? 0)).slice(0, count).map((c) => c.name);
    }
    return SIMPLE_POLICY.pickCards(choice, state);
  },
};

type Want = {generation: number, phase: Phase, label: string};

function tagsOf(state: CoachStateV1, analysis: CoachAnalysisV1): ChatFixture['tags'] {
  const plans = analysis.candidates;
  return {
    mode: state.game.mode, generation: state.game.generation, phase: state.game.phase, planCount: plans.length,
    goals: [...new Set(plans.map((p) => p.goal))],
    truncated: analysis.search.truncated,
    incompleteForecast: plans.some((p) => p.forecast !== undefined && !p.forecast.complete),
    unknownAvailability: plans.some((p) => p.cards.some((c) => c.availability === 'unknown')),
    legalNow: plans.some((p) => p.cards.some((c) => c.availability === 'legal-now')),
  };
}

function fixture(id: string, description: string, player: IPlayer): ChatFixture {
  const full = projectCoachState(player);
  const analysis = analyze(full, 3);
  // Board spaces are not used by the chat context and make the files large.
  const state = {...full, game: {...full.game, spaces: []}};
  const result = {id, description, tags: tagsOf(full, analysis), state, analysis};
  const json = JSON.stringify(result);
  const game = player.game;
  for (const secret of [...game.players.map((p) => p.id), game.spectatorId, `"${game.id}"`]) {
    if (json.includes(secret)) {
      throw new Error(`${id} contains an id`);
    }
  }
  return result;
}

async function play(gameId: string, players: Array<IPlayer>, seed: number, wants: Array<Want>, prefix: string, extra?: (p: IPlayer, gen: number) => ChatFixture | undefined): Promise<Array<ChatFixture>> {
  const game = Game.newInstance(gameId as GameId, players, players[0], `spectator-${gameId}` as SpectatorId, {}, seed);
  const viewer = players[0];
  const out: Array<ChatFixture> = [];
  const pending = [...wants];
  for (let i = 0; i < 5000 && game.phase !== Phase.END && pending.length > 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    const state = projectCoachState(viewer);
    const index = pending.findIndex((w) => w.generation === state.game.generation && w.phase === state.game.phase && state.choices.status === 'awaiting-input');
    if (index >= 0) {
      const want = pending.splice(index, 1)[0];
      out.push(fixture(`${prefix}-g${want.generation}-${want.phase}`, want.label, viewer));
      const more = extra?.(viewer, want.generation);
      if (more !== undefined) {
        out.push(more);
      }
    }
    const actor = players.find((p) => projectCoachState(p).choices.status === 'awaiting-input');
    if (actor === undefined) {
      break;
    }
    const own = projectCoachState(actor);
    if (own.choices.status !== 'awaiting-input') {
      break;
    }
    try {
      actor.process(answer(own.choices.root, own, BUYING));
    } catch {
      const pass = (own.choices.root.options ?? []).findIndex((o) => o.title === 'Pass for this generation');
      actor.process(pass >= 0 ? {type: 'or', index: pass, response: {type: 'option'}} : answer(own.choices.root, own, SIMPLE_POLICY));
    }
  }
  return out;
}

/** A position with a very large hand: the search stops at its limits (truncated). */
function bigHand(player: IPlayer, generation: number): ChatFixture | undefined {
  if (generation !== 5) {
    return undefined;
  }
  const saved = [...player.cardsInHand];
  // The next 60 cards of the draw pile join the hand for this snapshot only.
  player.cardsInHand.push(...player.game.projectDeck.drawPile.slice(-60));
  const result = fixture('solo-a-g5-bighand', 'Solo, generation 5, with a very large hand (search limits reached)', player);
  player.cardsInHand.length = 0;
  player.cardsInHand.push(...saved);
  return result;
}

async function main() {
  const outDir = process.argv[2] ?? path.join(__dirname, 'fixtures');
  fs.mkdirSync(outDir, {recursive: true});
  const all: Array<ChatFixture> = [];
  const action = (generation: number, label: string): Want => ({generation, phase: Phase.ACTION, label});
  const research = (generation: number, label: string): Want => ({generation, phase: Phase.RESEARCH, label});

  all.push(...await play('fixture-solo-a', [TestPlayer.BLUE.newPlayer()], 1, [
    research(1, 'Solo, start of the game: choose corporation and cards'),
    action(1, 'Solo, generation 1, first actions'),
    action(2, 'Solo, generation 2'),
    research(3, 'Solo, generation 3, buying cards'),
    action(4, 'Solo, generation 4'),
    action(5, 'Solo, generation 5'),
    action(7, 'Solo, generation 7, midgame'),
    research(8, 'Solo, generation 8, buying cards'),
    action(9, 'Solo, generation 9'),
    action(11, 'Solo, generation 11, late game'),
    action(13, 'Solo, generation 13'),
    action(14, 'Solo, last generation'),
  ], 'solo-a', bigHand));
  all.push(...await play('fixture-solo-b', [TestPlayer.BLUE.newPlayer()], 2, [
    action(2, 'Solo (other seed), generation 2'),
    action(4, 'Solo (other seed), generation 4'),
    research(6, 'Solo (other seed), generation 6, buying cards'),
    action(8, 'Solo (other seed), generation 8'),
    action(12, 'Solo (other seed), generation 12'),
  ], 'solo-b'));
  all.push(...await play('fixture-2p', [TestPlayer.BLUE.newPlayer(), TestPlayer.RED.newPlayer()], 3, [
    action(1, 'Two players, generation 1'),
    action(3, 'Two players, generation 3'),
    research(4, 'Two players, generation 4, buying cards'),
    action(5, 'Two players, generation 5'),
    action(7, 'Two players, generation 7'),
    action(9, 'Two players, generation 9'),
  ], '2p'));

  for (const f of all) {
    fs.writeFileSync(path.join(outDir, `${f.id}.json`), JSON.stringify(f, null, 1) + '\n');
  }
  console.log(all.map((f) => `${f.id}\tplans=${f.tags.planCount}\tgoals=${f.tags.goals.join('/')}\ttrunc=${f.tags.truncated}\tincomplete=${f.tags.incompleteForecast}\tunknown=${f.tags.unknownAvailability}\tlegal=${f.tags.legalNow}`).join('\n'));
  console.log(`${all.length} fixtures`);
}

void main();
