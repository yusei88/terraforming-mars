import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {ApiCoachCatalog, ApiCoachDecisions, ApiCoachState} from '../../../src/extensions/coach/server/routes';
import {CoachTracer, memorySink, setCoachTracer} from '../../../src/extensions/coach/server/coachTrace';
import {CoachStateV1} from '../../../src/extensions/coach/common/CoachState';
import {CoachCatalog} from '../../../src/extensions/coach/common/CoachCatalog';
import {RouteTestScaffolding} from '../../routes/RouteTestScaffolding';
import {MockResponse} from '../../routes/HttpMocks';
import {TestPlayer} from '../../TestPlayer';
import {statusCode} from '../../../src/common/http/statusCode';
import {extension} from '../../../src/extensions/coach/extension.server';
import {expectNoSecretIds} from './coachTestUtils';
import {Phase} from '../../../src/common/Phase';

// S28, S29: API contract and access control
describe('coach routes', () => {
  let scaffolding: RouteTestScaffolding;
  let res: MockResponse;

  beforeEach(() => {
    scaffolding = new RouteTestScaffolding();
    res = new MockResponse();
  });

  afterEach(() => {
    setCoachTracer(undefined);
  });

  async function twoPlayerGame() {
    const alice = TestPlayer.BLUE.newPlayer();
    const bob = TestPlayer.RED.newPlayer();
    const game = Game.newInstance('game-routes', [alice, bob], alice, 'spectator-routes');
    await scaffolding.ctx.gameLoader.add(game);
    return {game, alice, bob};
  }

  it('registers its routes and observer through the extension', () => {
    expect(extension.routes?.map(([path]) => path)).deep.eq(['api/coach/state', 'api/coach/catalog', 'api/coach/decisions']);
    expect(extension.inputObserver?.name).eq('coach-trace');
  });

  it('returns the snapshot of the requesting player', async () => {
    const {game, alice} = await twoPlayerGame();
    scaffolding.url = `/api/coach/state?id=${alice.id}`;
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.ok);
    expect(res.headers.get('Cache-Control')).eq('no-store');
    const state: CoachStateV1 = JSON.parse(res.content);
    expect(state.schemaVersion).eq('coach-state/1');
    expect(state.me.color).eq(alice.color);
    expect(state.opponents.map((o) => o.color)).deep.eq(['red']);
    expectNoSecretIds(state, game);
  });

  it('does not change the game when read repeatedly', async () => {
    const {game, alice} = await twoPlayerGame();
    const serialized = JSON.stringify(game.serialize());
    const fingerprints = new Set<string>();
    for (let i = 0; i < 5; i++) {
      res = new MockResponse();
      scaffolding.url = `/api/coach/state?id=${alice.id}`;
      await scaffolding.get(ApiCoachState.INSTANCE, res);
      fingerprints.add(JSON.parse(res.content).fingerprint);
    }
    expect(fingerprints.size).eq(1);
    expect(JSON.stringify(game.serialize())).eq(serialized);
  });

  it('refuses a missing or malformed id', async () => {
    scaffolding.url = '/api/coach/state';
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.badRequest);

    res = new MockResponse();
    scaffolding.url = '/api/coach/state?id=../../etc/passwd';
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.badRequest);
  });

  it('refuses spectator ids', async () => {
    const {game} = await twoPlayerGame();
    scaffolding.url = `/api/coach/state?id=${game.spectatorId}`;
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.badRequest);
  });

  it('answers 404 for an unknown player id', async () => {
    await twoPlayerGame();
    scaffolding.url = '/api/coach/state?id=p-unknown-player';
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.notFound);
  });

  it('enforces the Discord owner of a player like api/player', async () => {
    const {alice} = await twoPlayerGame();
    alice.user = '123';
    scaffolding.url = `/api/coach/state?id=${alice.id}`;
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.forbidden);

    res = new MockResponse();
    scaffolding.ctx.user = {id: '123', username: 'alice', discriminator: '0'};
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.ok);
  });

  it('keeps working for a finished game', async () => {
    const {game, alice} = await twoPlayerGame();
    game.phase = Phase.END;
    scaffolding.url = `/api/coach/state?id=${alice.id}`;
    await scaffolding.get(ApiCoachState.INSTANCE, res);
    const state: CoachStateV1 = JSON.parse(res.content);
    expect(state.choices.status).eq('game-over');
    expect(state.opponents[0].victoryPoints.status).eq('known');
  });

  it('serves the catalog with an ETag', async () => {
    scaffolding.url = '/api/coach/catalog';
    await scaffolding.get(ApiCoachCatalog.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.ok);
    const catalog: CoachCatalog = JSON.parse(res.content);
    expect(catalog.cards.length).greaterThan(500);
    const etag = res.headers.get('ETag');
    expect(etag).eq(`"${catalog.catalogVersion}"`);

    res = new MockResponse();
    scaffolding.req.headers['if-none-match'] = etag as string;
    await scaffolding.get(ApiCoachCatalog.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.notModified);
  });

  describe('decisions', () => {
    it('reports when tracing is off', async () => {
      const {alice} = await twoPlayerGame();
      setCoachTracer(undefined);
      scaffolding.url = `/api/coach/decisions?id=${alice.id}`;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      expect(JSON.parse(res.content)).deep.eq({tracing: false, history: {status: 'disabled', reason: 'COACH_TRACE_DIR is not set'}, events: []});
    });

    it('returns only the requesting player\'s events and snapshots', async () => {
      const {game, alice, bob} = await twoPlayerGame();
      const tracer = new CoachTracer(memorySink());
      setCoachTracer(tracer);
      tracer.observer.beforeInput(alice, {type: 'option'}, 0)!({accepted: false, error: 'a'});
      tracer.observer.beforeInput(bob, {type: 'option'}, 0)!({accepted: false, error: 'b'});

      scaffolding.url = `/api/coach/decisions?id=${alice.id}`;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      const body = JSON.parse(res.content);
      expect(body.tracing).is.true;
      expect(body.events.map((e: {error: string}) => e.error)).deep.eq(['a']);
      expectNoSecretIds(body, game);

      const aliceFingerprint = body.events[0].before.fingerprint;
      res = new MockResponse();
      scaffolding.url = `/api/coach/decisions?id=${alice.id}&fingerprint=${aliceFingerprint}`;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      expect(JSON.parse(res.content).me.color).eq(alice.color);

      // Bob's snapshot is not reachable with Alice's id, even with its fingerprint.
      const bobEvent = tracer.eventsOf(game.id, bob.color).events[0];
      if (bobEvent.type !== 'rejected') {
        throw new Error('unexpected event');
      }
      res = new MockResponse();
      scaffolding.url = `/api/coach/decisions?id=${alice.id}&fingerprint=${bobEvent.before.fingerprint}`;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      expect(res.statusCode).eq(statusCode.notFound);
    });

    it('validates the fingerprint parameter', async () => {
      const {alice} = await twoPlayerGame();
      setCoachTracer(new CoachTracer(memorySink()));
      scaffolding.url = `/api/coach/decisions?id=${alice.id}&fingerprint=nothex`;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      expect(res.statusCode).eq(statusCode.badRequest);
    });
  });
});
