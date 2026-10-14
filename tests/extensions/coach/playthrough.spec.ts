import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {IPlayer} from '../../../src/server/IPlayer';
import {Server} from '../../../src/server/models/ServerModel';
import {projectCoachState} from '../../../src/extensions/coach/server/projectCoachState';
import {CoachStateV1} from '../../../src/extensions/coach/common/CoachState';
import {TestPlayer} from '../../TestPlayer';
import {Phase} from '../../../src/common/Phase';
import {answer, expectNoSecretIds, Policy, SIMPLE_POLICY} from './coachTestUtils';
import {InputResponse} from '../../../src/common/inputs/InputResponse';
import {InMemoryDatabase} from '../../testing/InMemoryDatabase';
import {restoreTestDatabase, setTestDatabase} from '../../testing/setup';

type Step = {generation: number, phase: Phase, inputType: string, response: InputResponse};

/** Buys the two cheapest offered cards in generation 2 (S04), nothing otherwise (S03). */
const BUYING_POLICY: Policy = {
  ...SIMPLE_POLICY,
  pickCards(choice, state) {
    if (/buy/i.test(choice.title) && state.game.generation === 2) {
      return [...(choice.cards ?? [])]
        .sort((a, b) => (a.calculatedCost ?? 0) - (b.calculatedCost ?? 0))
        .slice(0, Math.min(2, choice.max ?? 0))
        .map((card) => card.name);
    }
    return SIMPLE_POLICY.pickCards(choice, state);
  },
};

function percentile(values: ReadonlyArray<number>, p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

// S03, S04, S12, S13, S14, S16, S17, S23: a whole solo game played through the normal input path.
describe('coach playthrough (solo, base game)', () => {
  const timings: Array<number> = [];
  const steps: Array<Step> = [];
  const rejected: Array<string> = [];
  const phasesSeen = new Set<string>();
  let restartChecks = 0;
  let finalState: CoachStateV1 | undefined;
  let player: IPlayer;
  let game: Game;

  // Fingerprint first observed after each save, by number of saves.
  const atSave = new Map<number, string>();
  let database: InMemoryDatabase;

  after(() => {
    restoreTestDatabase();
  });

  before(async () => {
    database = new class extends InMemoryDatabase {
      // The in-memory test database does not implement results; the end of the game needs them.
      override saveGameResults(): void {}
    }();
    setTestDatabase(database);
    player = TestPlayer.BLUE.newPlayer();
    game = Game.newInstance('game-playthrough', [player], player, 'spectator-playthrough');

    for (let i = 0; i < 3000 && game.phase !== Phase.END; i++) {
      // Saves are written asynchronously.
      await new Promise((resolve) => setImmediate(resolve));
      const started = performance.now();
      const state = projectCoachState(player);
      timings.push(performance.now() - started);
      phasesSeen.add(`${state.game.generation}:${state.game.phase}`);

      // S16: a reload gives the same snapshot.
      expect(projectCoachState(player).fingerprint).eq(state.fingerprint);
      expectNoSecretIds(state, game);

      // S17: a restart loads the last save; the coach must see exactly what it saw right after that save.
      const saves = database.games.get(game.id)?.length ?? 0;
      if (!atSave.has(saves)) {
        atSave.set(saves, state.fingerprint);
      }
      if (i % 5 === 0) {
        const restored = Game.deserialize(JSON.parse(JSON.stringify(await database.getGame(game.id))));
        const again = projectCoachState(restored.getPlayerById(player.id));
        expect(again.fingerprint, `restart at step ${i}`).eq(atSave.get(saves));
        restartChecks++;
      }

      if (state.choices.status !== 'awaiting-input') {
        throw new Error(`no input for the only player at step ${i}: ${state.choices.status}`);
      }
      const response = answer(state.choices.root, state, BUYING_POLICY);
      steps.push({generation: state.game.generation, phase: state.game.phase, inputType: state.choices.root.inputType, response});
      try {
        player.process(response);
      } catch (error) {
        // A refused answer must leave the state as it was.
        rejected.push(String(error));
        expect(projectCoachState(player).fingerprint).eq(state.fingerprint);
        player.process({type: 'or', index: (state.choices.root.options ?? []).findIndex((o) => o.title === 'Pass for this generation'), response: {type: 'option'}});
      }
    }
    finalState = projectCoachState(player);
  });

  it('reaches the end of the game', () => {
    expect(game.phase).eq(Phase.END);
    // S14
    expect(finalState?.choices.status).eq('game-over');
    expect(finalState?.game.gameOver).is.true;
    expect(finalState?.game.soloWin).is.a('boolean');
    const view = Server.getPlayerModel(player);
    if (finalState?.me.victoryPoints.status !== 'known') {
      throw new Error('VP should be known');
    }
    expect(finalState.me.victoryPoints.value.total).eq(view.thisPlayer.victoryPointsBreakdown.total);
  });

  it('passes through research, action and production of every generation (S13)', () => {
    const generations = new Set(steps.map((s) => s.generation));
    expect(generations.size).greaterThanOrEqual(14);
    for (const generation of generations) {
      if (generation > 1) {
        expect(phasesSeen.has(`${generation}:research`), `research ${generation}`).is.true;
      }
      expect(phasesSeen.has(`${generation}:action`), `action ${generation}`).is.true;
    }
  });

  it('buys no card and several cards in research (S03, S04)', () => {
    const research = steps.filter((s) => s.phase === Phase.RESEARCH && s.generation > 1);
    const bought = research.map((s) => (s.response.type === 'card' ? s.response.cards.length : -1));
    expect(bought).includes(0);
    expect(bought.some((n) => n >= 2)).is.true;
  });

  it('takes first and second actions and passes (S12)', () => {
    const actions = steps.filter((s) => s.phase === Phase.ACTION && s.inputType === 'or');
    expect(actions.length).greaterThan(14);
    const passes = actions.filter((s) => s.response.type === 'or' && s.response.response.type === 'option');
    expect(passes.length).greaterThanOrEqual(1);
  });

  it('rebuilds identical snapshots after a simulated restart (S17)', () => {
    expect(restartChecks).greaterThan(5);
  });

  it(`reads the state fast enough (S23: P95 < 200 ms)`, () => {
    const p95 = percentile(timings, 0.95);
    const max = Math.max(...timings);
    console.log(`      coach state: ${timings.length} reads, p50 ${percentile(timings, 0.5).toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms; rejected answers: ${rejected.length}`);
    expect(p95).lessThan(200);
  });
}).timeout(120_000);
