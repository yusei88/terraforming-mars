import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {IGame} from '../../../src/server/IGame';
import {IPlayer} from '../../../src/server/IPlayer';
import {GameLoader} from '../../../src/server/database/GameLoader';
import {PlayerInput} from '../../../src/server/routes/PlayerInput';
import {CoachTracer, memorySink, setCoachTracer} from '../../../src/extensions/coach/server/coachTrace';
import {projectCoachState} from '../../../src/extensions/coach/server/projectCoachState';
import {CoachDecisionEvent, CoachIntegrityEvent, CoachStateRecord, CoachTraceEvent} from '../../../src/extensions/coach/common/CoachTrace';
import {CoachStateV1} from '../../../src/extensions/coach/common/CoachState';
import {addInputObserver, removeInputObserver} from '../../../src/server/extensions/inputObservers';
import {restoreTestDatabase, restoreTestGameLoader, setTestDatabase, setTestGameLoader} from '../../testing/setup';
import {InMemoryDatabase} from '../../testing/InMemoryDatabase';
import {FakeClock} from '../../common/FakeClock';
import {RouteTestScaffolding} from '../../routes/RouteTestScaffolding';
import {MockRequest, MockResponse} from '../../routes/HttpMocks';
import {TestPlayer} from '../../TestPlayer';
import {CardName} from '../../../src/common/cards/CardName';
import {Payment} from '../../../src/common/inputs/Payment';
import {InputResponse} from '../../../src/common/inputs/InputResponse';
import {statusCode} from '../../../src/common/http/statusCode';
import {ApiCoachDecisions} from '../../../src/extensions/coach/server/routes';

type Sink = ReturnType<typeof memorySink>;

function root(state: CoachStateV1) {
  if (state.choices.status !== 'awaiting-input') {
    throw new Error(`no question: ${state.choices.status}`);
  }
  return state.choices.root;
}

function initialAnswer(player: IPlayer): InputResponse {
  const corporation = root(projectCoachState(player)).options![0].cards![0].name;
  return {type: 'initialCards', responses: [{type: 'card', cards: [corporation]}, {type: 'card', cards: []}]};
}

/* Standard project power plant (11 M€) from the action menu. */
function powerPlant(player: IPlayer): InputResponse {
  const index = root(projectCoachState(player)).options!.findIndex((o) => o.title === 'Standard projects');
  return {type: 'or', index, response: {type: 'projectCard', card: CardName.POWER_PLANT_STANDARD_PROJECT, payment: Payment.of({megacredits: 11})}};
}

/* Answers through the tracer exactly like the PlayerInput route does. */
function act(tracer: CoachTracer, player: IPlayer, response: InputResponse) {
  const done = tracer.observer.beforeInput(player, response, 1000)!;
  try {
    player.process(response);
  } catch (error) {
    done({accepted: false, error: String(error)});
    throw error;
  }
  done({accepted: true});
}

function events(sink: Sink, game: IGame): Array<CoachTraceEvent> {
  return sink.read(game.id, 'trace').records as Array<CoachTraceEvent>;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// P1.5-02, P1.5-04, P1.5-05: H05, H09-H15
describe('coach history', () => {
  let database: InMemoryDatabase;
  let sink: Sink;

  beforeEach(() => {
    database = new InMemoryDatabase();
    setTestDatabase(database);
    sink = memorySink();
  });

  afterEach(() => {
    restoreTestDatabase();
  });

  async function newSolo(undoOption: boolean) {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance(`game-history-${undoOption}`, [player], player, 'spectator-history', {undoOption});
    const tracer = new CoachTracer(sink);
    act(tracer, player, initialAnswer(player));
    await tick();
    return {game, player, tracer};
  }

  /* Rebuilds the game from its last save, as a server restart does, with a fresh tracer on the same files. */
  async function restart(game: IGame, playerId: IPlayer['id']) {
    await tick();
    const restored = Game.deserialize(JSON.parse(JSON.stringify(await database.getGame(game.id))));
    return {game: restored, player: restored.getPlayerById(playerId), tracer: new CoachTracer(sink)};
  }

  // H05
  it('never writes an event whose snapshot could not be stored', () => {
    const player = TestPlayer.BLUE.newPlayer();
    Game.newInstance('game-h05', [player], player, 'spectator-h05');
    const tracer = new CoachTracer(sink);
    sink.failNext('states', 'ENOSPC');
    act(tracer, player, initialAnswer(player));
    expect(sink.read(player.game.id, 'trace').records).is.empty;
    expect(tracer.health().eventsDropped).eq(1);

    // Second snapshot fails: the first stays as an orphan, still no event.
    sink.failNext('states', 'EIO');
    const done = tracer.observer.beforeInput(player, {type: 'option'}, 0)!;
    done({accepted: false, error: 'x'});
    expect(sink.read(player.game.id, 'trace').records).is.empty;

    const ok = tracer.observer.beforeInput(player, {type: 'option'}, 0)!;
    ok({accepted: false, error: 'y'});
    const written = events(sink, player.game);
    expect(written.map((e) => e.seq)).deep.eq([1]);
    const states = sink.read(player.game.id, 'states').records as Array<CoachStateRecord>;
    for (const event of written) {
      if (event.type === 'rejected') {
        expect(states.some((s) => s.fingerprint === event.before.fingerprint && s.advisoryFingerprint === event.before.advisoryFingerprint)).is.true;
      }
    }
  });

  // H12
  it('detects a rollback after a restart of a game without undo, read-only first', async () => {
    const {game, player, tracer} = await newSolo(false);
    act(tracer, player, powerPlant(player));
    expect(projectCoachState(player).me.production.energy).eq(1);

    const after = await restart(game, player.id);
    expect(projectCoachState(after.player).me.production.energy).eq(0);
    const linesBefore = events(sink, game).length;
    const assessment = after.tracer.assess(after.player, projectCoachState(after.player));
    expect(assessment.status).eq('rollback-detected');
    expect(assessment.lastConfirmed?.seq).eq(2);
    // Reading changed nothing.
    expect(events(sink, game).length).eq(linesBefore);

    act(after.tracer, after.player, powerPlant(after.player));
    const trace = events(sink, game);
    expect(trace.map((e) => e.type)).deep.eq(['decision', 'decision', 'integrity', 'decision']);
    const integrity = trace[2] as CoachIntegrityEvent;
    expect(integrity.status).eq('rollback-detected');
    expect(integrity.observed.branch).eq(1);
    expect((trace[3] as CoachDecisionEvent).before.branch).eq(1);
    // The lost move is no longer part of the line of play.
    const series = after.tracer.eventsOf(game.id, player.color).events.map((e) => [e.seq, e.series]);
    expect(series).deep.eq([[1, 'current'], [2, 'superseded'], [3, 'current'], [4, 'current']]);
    // Once recorded, the same mismatch is not reported again.
    expect(after.tracer.assess(after.player, projectCoachState(after.player)).status).eq('valid');
  });

  // H13
  it('finds no rollback after a restart of a game with undo', async () => {
    const {game, player, tracer} = await newSolo(true);
    act(tracer, player, powerPlant(player));
    const after = await restart(game, player.id);
    expect(projectCoachState(after.player).me.production.energy).eq(1);
    expect(after.tracer.assess(after.player, projectCoachState(after.player)).status).eq('valid');
    act(after.tracer, after.player, powerPlant(after.player));
    expect(events(sink, game).map((e) => e.type)).deep.eq(['decision', 'decision', 'decision']);
  });

  // H15
  it('does not take other players\' moves for a rollback', async () => {
    const alice = TestPlayer.BLUE.newPlayer();
    const bob = TestPlayer.RED.newPlayer();
    const game = Game.newInstance('game-h15', [alice, bob], alice, 'spectator-h15', {undoOption: true});
    const tracer = new CoachTracer(sink);
    act(tracer, alice, initialAnswer(alice));
    // Bob answers without the tracer (like an untraced client or an AI): only counters move.
    bob.process(initialAnswer(bob));
    await tick();
    const active = game.activePlayer;
    act(tracer, active, powerPlant(active));
    const other = active === alice ? bob : alice;
    expect(tracer.assess(other, projectCoachState(other)).status).eq('valid');
    expect(events(sink, game).filter((e) => e.type === 'integrity')).is.empty;
  });

  // H10
  it('reads Phase 1 records and continues them', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-h10', [player], player, 'spectator-h10');
    const state = projectCoachState(player);
    // A Phase 1 snapshot and event: no advisory fingerprint anywhere.
    const legacyState: Partial<CoachStateV1> = {...state};
    delete legacyState.advisoryFingerprint;
    sink.append(game.id, 'states', {type: 'state', color: player.color, fingerprint: state.fingerprint, state: legacyState});
    const legacyRef = {fingerprint: state.fingerprint, stateKey: state.stateKey, version: state.version, branch: 0};
    sink.append(game.id, 'trace', {schemaVersion: 'coach-trace/1', seq: 1, recordedAt: '2026-10-13T00:00:00.000Z', type: 'rejected',
      player: {color: player.color, name: player.name}, before: legacyRef, response: {type: 'option'}, error: 'old', decidedAt: '2026-10-13T00:00:00.000Z'});

    const tracer = new CoachTracer(sink);
    expect(tracer.eventsOf(game.id, player.color).events.map((e) => [e.seq, e.series])).deep.eq([[1, 'current']]);
    const snapshot = tracer.historySnapshot(game.id, player.color, 1, 'before')!;
    expect(snapshot.precision).eq('legacy-content-only');
    expect(snapshot.reference.advisoryFingerprint).is.undefined;
    expect(snapshot.snapshot.fingerprint).eq(state.fingerprint);

    tracer.observer.beforeInput(player, {type: 'option'}, 0)!({accepted: false, error: 'new'});
    const trace = events(sink, game);
    expect(trace.map((e) => e.seq)).deep.eq([1, 2]);
    expect((trace[1] as {before: {advisoryFingerprint?: string}}).before.advisoryFingerprint).eq(state.advisoryFingerprint);
    expect(tracer.historySnapshot(game.id, player.color, 2, 'before')!.precision).eq('exact');
  });

  // P2-17 (G0): an unreadable history is never valid, and nothing is written on top of it
  it('treats an unreadable history as uncertain and writes nothing', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-p217', [player], player, 'spectator-p217');
    const tracer = new CoachTracer(sink);
    act(tracer, player, initialAnswer(player));
    expect(events(sink, game)).has.length(1);

    sink.failReads('trace', 'EIO');
    const restarted = new CoachTracer(sink);
    const assessment = restarted.assess(player, projectCoachState(player));
    expect(assessment.status).eq('uncertain');
    expect(assessment.reason).contains('EIO');
    expect(restarted.eventsOf(game.id, player.color)).deep.eq({events: [], error: 'EIO'});
    expect(restarted.historySnapshot(game.id, player.color, 1, 'after')).is.undefined;
    expect(restarted.lastConfirmed(game.id)).is.undefined;

    restarted.observer.beforeInput(player, {type: 'option'}, 0)!({accepted: false, error: 'x'});
    sink.failReads('trace', undefined);
    expect(events(sink, game).map((e) => e.seq)).deep.eq([1]);
    expect(restarted.health().historyReadFailures).eq(1);
    expect(restarted.health().status).eq('degraded');

    // Readable again: numbering continues from the file, no reuse of seq 1.
    restarted.observer.beforeInput(player, {type: 'option'}, 0)!({accepted: false, error: 'y'});
    expect(events(sink, game).map((e) => e.seq)).deep.eq([1, 2]);
  });

  // P2-18 (G0): a new-style reference never falls back to another snapshot with the same content
  it('does not fall back when the advisory fingerprint does not match', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-p218', [player], player, 'spectator-p218');
    const tracer = new CoachTracer(sink);
    act(tracer, player, initialAnswer(player));
    const decision = events(sink, game)[0] as CoachDecisionEvent;
    expect(tracer.historySnapshot(game.id, player.color, 1, 'after')?.precision).eq('exact');

    // Same content, other warnings: only this record remains for the fingerprint.
    const lines = sink.lines.get(`${game.id}.states`) as Array<CoachStateRecord>;
    for (const record of lines) {
      if (record.fingerprint === decision.after.fingerprint) {
        record.advisoryFingerprint = 'f'.repeat(64);
      }
    }
    expect(tracer.historySnapshot(game.id, player.color, 1, 'after')).is.undefined;
  });

  describe('through the routes', () => {
    let scaffolding: RouteTestScaffolding;
    let tracer: CoachTracer;

    beforeEach(() => {
      const loader = GameLoader.newTestInstance({sleepMillis: 0, evictMillis: 100, idleMillis: 1000, sweep: 'manual'}, new FakeClock());
      setTestGameLoader(loader);
      loader.resetForTesting();
      scaffolding = new RouteTestScaffolding();
      scaffolding.ctx.gameLoader = loader;
      tracer = new CoachTracer(sink);
      addInputObserver(tracer.observer);
      setCoachTracer(tracer);
    });

    afterEach(() => {
      removeInputObserver(tracer.observer);
      setCoachTracer(undefined);
      restoreTestGameLoader();
    });

    async function send(playerId: string, body: InputResponse) {
      const req = new MockRequest();
      const res = new MockResponse();
      scaffolding.req = req;
      scaffolding.url = `/player/input?id=${playerId}`;
      const post = scaffolding.post(PlayerInput.INSTANCE, res);
      const emit = new Promise<void>((resolve) => setTimeout(() => {
        req.emitString(JSON.stringify(body));
        req.emitter.emit('end');
        resolve();
      }, 20));
      await Promise.all([emit, post]);
      expect(res.statusCode, res.content).eq(statusCode.ok);
    }

    async function get(url: string) {
      const res = new MockResponse();
      scaffolding.url = url;
      await scaffolding.get(ApiCoachDecisions.INSTANCE, res);
      return res;
    }

    async function live(playerId: IPlayer['id']) {
      return (await scaffolding.ctx.gameLoader.getGame(playerId))!.getPlayerById(playerId);
    }

    // H09, H14
    it('keeps each event at its own place when the same position is reached again', async () => {
      const player = TestPlayer.BLUE.newPlayer();
      const game = Game.newInstance('game-h09', [player], player, 'spectator-h09', {undoOption: true});
      await scaffolding.ctx.gameLoader.add(game);
      await send(player.id, initialAnswer(player));
      await send(player.id, powerPlant(await live(player.id)));
      const undo = root(projectCoachState(await live(player.id))).options!.findIndex((o) => o.title === 'Undo last action');
      await send(player.id, {type: 'or', index: undo, response: {type: 'option'}});
      await send(player.id, powerPlant(await live(player.id)));

      const trace = events(sink, game);
      expect(trace.map((e) => `${e.seq}:${e.type}`)).deep.eq(['1:decision', '2:decision', '3:revert', '4:decision']);
      const first = trace[1] as CoachDecisionEvent;
      const again = trace[3] as CoachDecisionEvent;
      expect(again.after.fingerprint).eq(first.after.fingerprint);
      expect([first.after.branch, again.after.branch]).deep.eq([0, 1]);

      const a = JSON.parse((await get(`/api/coach/decisions?id=${player.id}&seq=2&position=after`)).content);
      const b = JSON.parse((await get(`/api/coach/decisions?id=${player.id}&seq=4&position=after`)).content);
      expect(a.reference).deep.include({seq: 2, branch: 0, series: 'superseded', stateKey: first.after.stateKey});
      expect(b.reference).deep.include({seq: 4, branch: 1, series: 'current', stateKey: again.after.stateKey});
      expect(a.snapshot.version).deep.eq(first.after.version);
      expect(b.snapshot.version).deep.eq(again.after.version);
      expect(b.snapshot.stateKey).not.eq(a.snapshot.stateKey);
      expect(a.precision).eq('exact');

      // H14: restart after the undo: no rollback reported, the undo is not recorded twice.
      await tick();
      const restored = Game.deserialize(JSON.parse(JSON.stringify(await database.getGame(game.id))));
      const restarted = new CoachTracer(sink);
      expect(restarted.assess(restored.getPlayerById(player.id), projectCoachState(restored.getPlayerById(player.id))).status).eq('valid');
      const list = JSON.parse((await get(`/api/coach/decisions?id=${player.id}`)).content);
      expect(list.history.status).eq('valid');
      expect(list.events.filter((e: CoachTraceEvent) => e.type === 'revert')).has.length(1);
      expect(list.health.status).eq('ok');
    });

    // H11
    it('never returns another player\'s event or snapshot', async () => {
      const alice = TestPlayer.BLUE.newPlayer();
      const bob = TestPlayer.RED.newPlayer();
      const game = Game.newInstance('game-h11', [alice, bob], alice, 'spectator-h11');
      await scaffolding.ctx.gameLoader.add(game);
      await send(bob.id, initialAnswer(bob));
      const bobEvent = events(sink, game)[0] as CoachDecisionEvent;

      expect((await get(`/api/coach/decisions?id=${alice.id}&seq=${bobEvent.seq}&position=before`)).statusCode).eq(statusCode.notFound);
      expect((await get(`/api/coach/decisions?id=${alice.id}&fingerprint=${bobEvent.before.fingerprint}`)).statusCode).eq(statusCode.notFound);
      const list = JSON.parse((await get(`/api/coach/decisions?id=${alice.id}`)).content);
      expect(list.events).is.empty;
      expect(JSON.stringify(list)).does.not.contain(bobEvent.before.fingerprint);
      expect((await get(`/api/coach/decisions?id=${bob.id}&seq=${bobEvent.seq}&position=before`)).statusCode).eq(statusCode.ok);
      expect((await get(`/api/coach/decisions?id=${bob.id}&seq=1&position=sideways`)).statusCode).eq(statusCode.badRequest);
      expect((await get(`/api/coach/decisions?id=${bob.id}&seq=-1&position=before`)).statusCode).eq(statusCode.badRequest);
    });
  });
});
