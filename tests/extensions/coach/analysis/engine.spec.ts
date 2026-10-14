import {expect} from 'chai';
import {analysesComputed, analyze, ANALYSIS_VERSION, cacheKey, setAnalyzerForTesting} from '../../../../src/extensions/coach/server/analysis/engine';
import {ApiCoachAnalysis} from '../../../../src/extensions/coach/server/routes';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {CoachAnalysisV1} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {RouteTestScaffolding} from '../../../routes/RouteTestScaffolding';
import {MockResponse} from '../../../routes/HttpMocks';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {Game} from '../../../../src/server/Game';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {Phase} from '../../../../src/common/Phase';
import {statusCode} from '../../../../src/common/http/statusCode';
import {newCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {addCity} from '../../../TestingUtils';

const HAND = [CardName.EARTH_OFFICE, CardName.CARTEL, CardName.MINE, CardName.POWER_PLANT, CardName.ALGAE, CardName.LUNAR_BEAM, CardName.SPONSORS];

function setUp(game: IGame, player: TestPlayer) {
  game.phase = Phase.ACTION;
  player.cardsInHand.push(...HAND.map((name) => newCard(name) as IProjectCard));
  player.megaCredits = 40;
  player.takeAction();
}

describe('coach analysis engine and API', () => {
  let scaffolding: RouteTestScaffolding;

  beforeEach(() => {
    scaffolding = new RouteTestScaffolding();
    setAnalyzerForTesting(undefined);
  });

  afterEach(() => {
    setAnalyzerForTesting(undefined);
  });

  async function get(url: string): Promise<MockResponse> {
    const res = new MockResponse();
    scaffolding.url = url;
    await scaffolding.get(ApiCoachAnalysis.INSTANCE, res);
    return res;
  }

  async function soloGame() {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    setUp(game, player);
    await scaffolding.ctx.gameLoader.add(game);
    return {game, player};
  }

  it('returns coach-analysis/1 for the requesting player', async () => {
    const {game, player} = await soloGame();
    const res = await get(`/api/coach/analysis?id=${player.id}`);
    expect(res.statusCode).eq(statusCode.ok);
    expect(res.headers.get('Cache-Control')).eq('no-store');
    const analysis: CoachAnalysisV1 = JSON.parse(res.content);
    const state = projectCoachState(player);
    expect(analysis.schemaVersion).eq('coach-analysis/1');
    expect(analysis.source).deep.include({fingerprint: state.fingerprint, advisoryFingerprint: state.advisoryFingerprint, catalogVersion: state.catalogVersion, analysisVersion: ANALYSIS_VERSION});
    expect(analysis.horizonProductionPhases).eq(3);
    expect(analysis.candidates.length).greaterThan(0);
    expect(analysis.candidates.every((c) => c.forecast?.horizonProductionPhases === 3)).is.true;
    expect(analysis.coverage.supported + analysis.coverage.partial + analysis.coverage.unsupported).greaterThan(0);
    expect(analysis.limitations.length).greaterThan(0);
    const json = res.content;
    expect(json).does.not.contain(player.id);
    expect(json).does.not.contain(game.spectatorId);
    expect(json).does.not.contain(`"${game.id}"`);
  });

  it('accepts horizons 0–3 only', async () => {
    const {player} = await soloGame();
    for (const horizon of ['0', '1', '2', '3']) {
      const res = await get(`/api/coach/analysis?id=${player.id}&horizon=${horizon}`);
      expect(res.statusCode, horizon).eq(statusCode.ok);
      expect(JSON.parse(res.content).horizonProductionPhases).eq(Number(horizon));
    }
    for (const horizon of ['4', '-1', 'x', '1.5', '']) {
      expect((await get(`/api/coach/analysis?id=${player.id}&horizon=${horizon}`)).statusCode, horizon).eq(statusCode.badRequest);
    }
  });

  it('refuses spectators, unknown and malformed ids, and other Discord users', async () => {
    const {game, player} = await soloGame();
    expect((await get(`/api/coach/analysis?id=${game.spectatorId}`)).statusCode).eq(statusCode.badRequest);
    expect((await get('/api/coach/analysis?id=p-nobody')).statusCode).eq(statusCode.notFound);
    expect((await get('/api/coach/analysis?id=../x')).statusCode).eq(statusCode.badRequest);
    player.user = '123';
    expect((await get(`/api/coach/analysis?id=${player.id}`)).statusCode).eq(statusCode.forbidden);
  });

  // P2-21
  it('gives the same result for the same position and does not change the game', async () => {
    const {game, player} = await soloGame();
    const serialized = JSON.stringify(game.serialize());
    const first = (await get(`/api/coach/analysis?id=${player.id}`)).content;
    const computed = analysesComputed();
    const again = (await get(`/api/coach/analysis?id=${player.id}`)).content;
    expect(again).eq(first);
    // Served from the cache: nothing computed the second time.
    expect(analysesComputed()).eq(computed);
    expect(JSON.stringify(game.serialize())).eq(serialized);
  });

  it('never shares a cached result between players', async () => {
    const [game, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    await scaffolding.ctx.gameLoader.add(game);
    alice.cardsInHand.push(newCard(CardName.EARTH_OFFICE) as IProjectCard, newCard(CardName.CARTEL) as IProjectCard);
    bob.cardsInHand.push(newCard(CardName.SPACE_STATION) as IProjectCard, newCard(CardName.ASTEROID) as IProjectCard);
    const forAlice = (await get(`/api/coach/analysis?id=${alice.id}`)).content;
    const forBob = (await get(`/api/coach/analysis?id=${bob.id}`)).content;
    expect(forAlice).does.not.contain(CardName.SPACE_STATION);
    expect(forBob).does.not.contain(CardName.EARTH_OFFICE);
    expect(cacheKey(projectCoachState(alice), 3, alice.id)).not.eq(cacheKey(projectCoachState(alice), 3, bob.id));
    expect(cacheKey(projectCoachState(alice), 3, alice.id)).does.not.contain(alice.id);
  });

  // P2-20
  it('follows public changes made by another player', async () => {
    const [game, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    await scaffolding.ctx.gameLoader.add(game);
    alice.cardsInHand.push(newCard(CardName.CARTEL) as IProjectCard);
    const before: CoachAnalysisV1 = JSON.parse((await get(`/api/coach/analysis?id=${alice.id}`)).content);
    addCity(bob);
    const after: CoachAnalysisV1 = JSON.parse((await get(`/api/coach/analysis?id=${alice.id}`)).content);
    expect(after.source.fingerprint).not.eq(before.source.fingerprint);
    expect(after.source.fingerprint).eq(projectCoachState(alice).fingerprint);
  });

  // P2-16: after an undo the analysis follows the restored position; history positions are separate (Phase 1.5).
  it('analyses the position after an undo, and the same position gives the same plans', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-p216', [player], player, 'spectator-p216', {undoOption: true});
    const start = projectCoachState(player);
    const restored = Game.deserialize(game.serialize()).getPlayerById(player.id);
    const back = projectCoachState(restored);
    expect(back.fingerprint).eq(start.fingerprint);
    const a = analyze(start, 3, undefined, new Date(0));
    const b = analyze(back, 3, undefined, new Date(0));
    expect(b.candidates).deep.eq(a.candidates);
    expect(b.source.fingerprint).eq(a.source.fingerprint);
  });

  it('isolates a failing analysis from the game', async () => {
    const {game, player} = await soloGame();
    setAnalyzerForTesting(() => {
      throw new Error('boom');
    });
    const res = await get(`/api/coach/analysis?id=${player.id}`);
    expect(res.statusCode).eq(statusCode.internalServerError);
    expect(res.content).does.not.contain('boom');
    // The game goes on.
    expect(player.getWaitingFor()).is.not.undefined;
    expect(game.phase).eq(Phase.ACTION);
  });

  it('analyses within the time target in-process', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    setUp(game, player);
    const state = projectCoachState(player);
    const times: Array<number> = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      analyze(state, 3);
      times.push(performance.now() - started);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.ceil(0.95 * times.length) - 1]).lessThan(500);
  });
});
