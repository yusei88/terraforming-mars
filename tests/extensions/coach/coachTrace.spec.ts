import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {IGame} from '../../../src/server/IGame';
import {GameLoader} from '../../../src/server/database/GameLoader';
import {PlayerInput} from '../../../src/server/routes/PlayerInput';
import {CancelAction} from '../../../src/server/routes/CancelAction';
import {CoachTracer, memorySink} from '../../../src/extensions/coach/server/coachTrace';
import {CoachDecisionEvent, CoachRejectedInputEvent, CoachRevertEvent, CoachStateRecord} from '../../../src/extensions/coach/common/CoachTrace';
import {projectCoachState} from '../../../src/extensions/coach/server/projectCoachState';
import {addInputObserver, observeInput, removeInputObserver, PlayerInputObserver} from '../../../src/server/extensions/inputObservers';
import {restoreTestDatabase, restoreTestGameLoader, setTestDatabase, setTestGameLoader} from '../../testing/setup';
import {InMemoryDatabase} from '../../testing/InMemoryDatabase';
import {FakeClock} from '../../common/FakeClock';
import {RouteTestScaffolding} from '../../routes/RouteTestScaffolding';
import {MockRequest, MockResponse} from '../../routes/HttpMocks';
import {TestPlayer} from '../../TestPlayer';
import {testGame} from '../../TestGame';
import {Phase} from '../../../src/common/Phase';
import {PowerPlant} from '../../../src/server/cards/base/PowerPlant';
import {CardName} from '../../../src/common/cards/CardName';
import {Payment} from '../../../src/common/inputs/Payment';
import {statusCode} from '../../../src/common/http/statusCode';
import {expectNoSecretIds} from './coachTestUtils';
import {InputResponse} from '../../../src/common/inputs/InputResponse';

const fixedClock = () => new Date('2026-10-14T00:00:00.000Z');

// S18, S20: decision history
describe('coach trace', () => {
  let sink: ReturnType<typeof memorySink>;
  let tracer: CoachTracer;

  beforeEach(() => {
    sink = memorySink();
    tracer = new CoachTracer(sink, fixedClock);
  });

  function events(game: IGame) {
    return sink.read(game.id, 'trace').records as Array<CoachDecisionEvent | CoachRejectedInputEvent | CoachRevertEvent>;
  }

  function actionMenuWithPowerPlant() {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    player.megaCredits = 20;
    player.cardsInHand.push(new PowerPlant());
    player.takeAction();
    return {game, player};
  }

  function playPowerPlant(state = projectCoachState(actionMenuWithPowerPlant().player)): InputResponse {
    if (state.choices.status !== 'awaiting-input') {
      throw new Error('no input');
    }
    const index = state.choices.root.options!.findIndex((o) => o.inputType === 'projectCard');
    return {type: 'or', index, response: {type: 'projectCard', card: CardName.POWER_PLANT, payment: Payment.of({megacredits: 4})}};
  }

  it('records the state before and after an accepted answer', () => {
    const {game, player} = actionMenuWithPowerPlant();
    const before = projectCoachState(player);
    const response = playPowerPlant(before);

    const done = tracer.observer.beforeInput(player, response, 4200)!;
    player.process(response);
    done({accepted: true});

    const trace = events(game);
    expect(trace).has.length(1);
    const decision = trace[0] as CoachDecisionEvent;
    expect(decision.type).eq('decision');
    expect(decision.seq).eq(1);
    expect(decision.player).deep.eq({color: player.color, name: player.name});
    expect(decision.before.fingerprint).eq(before.fingerprint);
    expect(decision.after.fingerprint).not.eq(before.fingerprint);
    expect(decision.offered?.inputType).eq('or');
    expect(decision.response).deep.eq(response);
    expect(decision.thinkingMilliseconds).eq(4200);
    expect(decision.askedAt).eq('2026-10-13T23:59:55.800Z');
    expect(decision.before.branch).eq(0);

    // The snapshot before the answer still has Power Plant in hand; the one after has it in play.
    const states = sink.read(game.id, 'states').records as Array<CoachStateRecord>;
    expect(states).has.length(2);
    const beforeState = tracer.stateOf(game.id, player.color, decision.before.fingerprint)!;
    const afterState = tracer.stateOf(game.id, player.color, decision.after.fingerprint)!;
    expect(beforeState.me.hand.map((c) => c.name)).includes(CardName.POWER_PLANT);
    expect(afterState.me.tableau.map((c) => c.name)).includes(CardName.POWER_PLANT);
    expectNoSecretIds(sink.lines.get(`${game.id}.trace`), game);
    expectNoSecretIds(states, game);
  });

  it('does not record a refused answer as a decision', () => {
    const {game, player} = actionMenuWithPowerPlant();
    const done = tracer.observer.beforeInput(player, {type: 'card', cards: []}, undefined)!;
    done({accepted: false, error: 'Not a valid OrOptionsResponse'});

    const trace = events(game);
    expect(trace.map((e) => e.type)).deep.eq(['rejected']);
    expect((trace[0] as CoachRejectedInputEvent).error).eq('Not a valid OrOptionsResponse');
    expect(Object.keys(trace[0])).does.not.include('after');
  });

  it('skips AI players', () => {
    const {player} = actionMenuWithPowerPlant();
    player.aiLevel = 'normal';
    expect(tracer.observer.beforeInput(player, {type: 'option'}, 0)).is.undefined;
  });

  it('continues numbering and branches after a server restart', () => {
    const {game, player} = actionMenuWithPowerPlant();
    tracer.observer.beforeInput(player, {type: 'option'}, 0)!({accepted: false, error: 'x'});
    tracer.observer.beforeRevert!(player, 'undo')!(player);

    const restarted = new CoachTracer(sink, fixedClock);
    restarted.observer.beforeInput(player, {type: 'option'}, 0)!({accepted: false, error: 'y'});
    const trace = events(game);
    expect(trace.map((e) => e.seq)).deep.eq([1, 2, 3]);
    expect((trace[2] as CoachRejectedInputEvent).before.branch).eq(1);
  });

  it('a failing observer never blocks the game', () => {
    const {player} = actionMenuWithPowerPlant();
    const broken: PlayerInputObserver = {
      name: 'broken',
      beforeInput: () => {
        throw new Error('boom');
      },
    };
    addInputObserver(broken);
    try {
      const done = observeInput(player, playPowerPlant(projectCoachState(player)), 0);
      player.process(playPowerPlant(projectCoachState(player)));
      done({accepted: true});
      expect(player.tableau.has(CardName.POWER_PLANT)).is.true;
    } finally {
      removeInputObserver(broken);
    }
  });

  it('records a cancelled action as a revert', async () => {
    const scaffolding = new RouteTestScaffolding();
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    await scaffolding.ctx.gameLoader.add(game);
    game.phase = Phase.ACTION;
    player.megaCredits = 30;
    player.takeAction();
    const start = projectCoachState(player);
    if (start.choices.status !== 'awaiting-input') {
      throw new Error('no action menu');
    }
    const projects = start.choices.root.options!.findIndex((o) => o.title === 'Standard projects');
    player.process({type: 'or', index: projects, response: {type: 'projectCard', card: CardName.CITY_STANDARD_PROJECT, payment: Payment.of({megacredits: 25})}});
    expect(projectCoachState(player).choices.status === 'awaiting-input' && projectCoachState(player).me.resources.megacredits).eq(5);

    addInputObserver(tracer.observer);
    try {
      const res = new MockResponse();
      scaffolding.url = `/player/cancel-action?id=${player.id}`;
      await scaffolding.post(CancelAction.INSTANCE, res);
      expect(res.statusCode).eq(statusCode.ok);
    } finally {
      removeInputObserver(tracer.observer);
    }
    const revert = events(game)[0] as CoachRevertEvent;
    expect(revert.type).eq('revert');
    expect(revert.kind).eq('cancel-action');
    expect(revert.to?.branch).eq(1);
    const restored = tracer.stateOf(game.id, player.color, revert.to!.fingerprint)!;
    expect(restored.me.resources.megacredits).eq(30);
  });

  describe('through the player input route', () => {
    let scaffolding: RouteTestScaffolding;
    let res: MockResponse;
    let database: InMemoryDatabase;

    beforeEach(() => {
      database = new InMemoryDatabase();
      setTestDatabase(database);
      const loader = GameLoader.newTestInstance({sleepMillis: 0, evictMillis: 100, idleMillis: 1000, sweep: 'manual'}, new FakeClock());
      setTestGameLoader(loader);
      loader.resetForTesting();
      scaffolding = new RouteTestScaffolding();
      scaffolding.ctx.gameLoader = loader;
      addInputObserver(tracer.observer);
    });

    afterEach(() => {
      removeInputObserver(tracer.observer);
      restoreTestDatabase();
      restoreTestGameLoader();
    });

    async function send(playerId: string, body: InputResponse | string): Promise<MockResponse> {
      const req = new MockRequest();
      res = new MockResponse();
      scaffolding.req = req;
      scaffolding.url = `/player/input?id=${playerId}`;
      const post = scaffolding.post(PlayerInput.INSTANCE, res);
      // The real GameLoader resolves the game over several ticks; send the body once the route listens.
      const emit = new Promise<void>((resolve) => setTimeout(() => {
        req.emitString(typeof body === 'string' ? body : JSON.stringify(body));
        req.emitter.emit('end');
        resolve();
      }, 20));
      await Promise.all([emit, post]);
      return res;
    }

    async function soloWithUndo() {
      const player = TestPlayer.BLUE.newPlayer();
      const game = Game.newInstance('game-undo', [player], player, 'spectator-undo', {undoOption: true});
      await scaffolding.ctx.gameLoader.add(game);
      const initial = projectCoachState(player);
      if (initial.choices.status !== 'awaiting-input') {
        throw new Error('no initial choice');
      }
      const corporation = initial.choices.root.options![0].cards![0].name;
      await send(player.id, {type: 'initialCards', responses: [{type: 'card', cards: [corporation]}, {type: 'card', cards: []}]});
      expect(res.statusCode).eq(statusCode.ok);
      return {game, player};
    }

    // S18
    it('records undo as a new branch and returns to the same content', async () => {
      const {game, player} = await soloWithUndo();
      const live = () => game.getPlayerById(player.id);
      const start = projectCoachState(live());
      if (start.choices.status !== 'awaiting-input') {
        throw new Error('no action menu');
      }
      // Standard project: power plant (11 M€).
      const projects = start.choices.root.options!.findIndex((o) => o.title === 'Standard projects');
      expect(projects).greaterThanOrEqual(0);
      await send(player.id, {type: 'or', index: projects, response: {type: 'projectCard', card: CardName.POWER_PLANT_STANDARD_PROJECT, payment: Payment.of({megacredits: 11})}});
      expect(res.statusCode).eq(statusCode.ok);

      const loaded = await scaffolding.ctx.gameLoader.getGame(player.id);
      const afterAction = projectCoachState(loaded!.getPlayerById(player.id));
      expect(afterAction.me.production.energy).eq(1);
      if (afterAction.choices.status !== 'awaiting-input') {
        throw new Error('no second action');
      }
      const undo = afterAction.choices.root.options!.findIndex((o) => o.title === 'Undo last action');
      expect(undo).greaterThanOrEqual(0);
      await send(player.id, {type: 'or', index: undo, response: {type: 'option'}});

      const restoredGame = await scaffolding.ctx.gameLoader.getGame(player.id);
      const restored = projectCoachState(restoredGame!.getPlayerById(player.id));
      expect(restored.me.production.energy).eq(0);
      expect(restored.fingerprint).eq(start.fingerprint);
      expect(restored.stateKey).not.eq(start.stateKey);

      const trace = events(game);
      expect(trace.map((e) => e.type)).deep.eq(['decision', 'decision', 'revert']);
      const revert = trace[2] as CoachRevertEvent;
      expect(revert.kind).eq('undo');
      expect(revert.from.fingerprint).eq(afterAction.fingerprint);
      expect(revert.to?.fingerprint).eq(start.fingerprint);
      expect(revert.to?.branch).eq(1);
      expect(revert.from.branch).eq(0);
    });

    // S20: invalid input through the route
    it('records a refused input only as rejected', async () => {
      const {game, player} = await soloWithUndo();
      const before = events(game).length;
      await send(player.id, {type: 'or', index: 999, response: {type: 'option'}});
      expect(res.statusCode).eq(statusCode.badRequest);
      const added = events(game).slice(before);
      expect(added.map((e) => e.type)).deep.eq(['rejected']);
    });
  });
});
