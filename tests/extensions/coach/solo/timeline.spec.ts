import {expect} from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {Game} from '../../../../src/server/Game';
import {CoachTracer, fileSink, memorySink, setCoachTracer} from '../../../../src/extensions/coach/server/coachTrace';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {buildTimeline, normalizeDecision} from '../../../../src/extensions/coach/server/solo/timeline';
import {ApiCoachTimeline} from '../../../../src/extensions/coach/server/routes';
import {CoachTimelineV1, TimelineEvent} from '../../../../src/extensions/coach/common/CoachTimeline';
import {CoachTraceEvent} from '../../../../src/extensions/coach/common/CoachTrace';
import {CardName} from '../../../../src/common/cards/CardName';
import {IPlayer} from '../../../../src/server/IPlayer';
import {Phase} from '../../../../src/common/Phase';
import {statusCode} from '../../../../src/common/http/statusCode';
import {RouteTestScaffolding} from '../../../routes/RouteTestScaffolding';
import {MockResponse} from '../../../routes/HttpMocks';
import {TestPlayer} from '../../../TestPlayer';
import {expectNoSecretIds} from '../coachTestUtils';
import {act, newSolo, pass, play, root, setHand, tick} from './soloTestUtils';
import {InMemoryDatabase} from '../../../testing/InMemoryDatabase';
import {restoreTestDatabase, restoreTestGameLoader, setTestDatabase, setTestGameLoader} from '../../../testing/setup';
import {GameLoader} from '../../../../src/server/database/GameLoader';
import {FakeClock} from '../../../common/FakeClock';
import {MockRequest} from '../../../routes/HttpMocks';
import {PlayerInput} from '../../../../src/server/routes/PlayerInput';
import {addInputObserver, removeInputObserver} from '../../../../src/server/extensions/inputObservers';
import {InputResponse} from '../../../../src/common/inputs/InputResponse';
import {Payment} from '../../../../src/common/inputs/Payment';

function timeline(tracer: CoachTracer | undefined, player: IPlayer): CoachTimelineV1 {
  const state = projectCoachState(player);
  return buildTimeline({tracer, gameId: player.game.id, color: player.color, state, history: () => tracer?.assess(player, state).status ?? 'disabled'});
}

function all(t: CoachTimelineV1): Array<TimelineEvent> {
  return t.generations.flatMap((g) => g.events);
}

// P3-SOLO-1: decisions of a solo game as meaningful events.
describe('solo timeline (P3-SOLO-1)', () => {
  let sink: ReturnType<typeof memorySink>;
  let tracer: CoachTracer;

  beforeEach(() => {
    sink = memorySink();
    tracer = new CoachTracer(sink);
  });

  afterEach(() => setCoachTracer(undefined));

  it('shows the cards bought at the start, as one purchase', () => {
    const {player, bought} = newSolo(tracer, 'solo-tl-start', 3);
    const t = timeline(tracer, player);
    expect(t.status).eq('ok');
    expect(t.solo).deep.eq({victory: 'terraform', lastGeneration: 14});
    const start = all(t).find((e) => e.kind === 'initial-selection');
    expect(start).to.deep.include({generation: 1, verified: true, order: 1});
    expect(start?.cards).deep.eq(bought);
    expect(start?.cards).has.length(3);
    expect(start?.chosen).has.length(1);
  });

  it('shows a research purchase of three cards with its generation, not as three plays', () => {
    const {player} = newSolo(tracer, 'solo-tl-buy', 0);
    pass(tracer, player);
    const research = root(projectCoachState(player));
    expect(player.game.phase).eq(Phase.RESEARCH);
    expect(research.title).match(/buy/i);
    const cards = research.cards!.slice(0, 3).map((c) => c.name);
    act(tracer, player, {type: 'card', cards});
    const t = timeline(tracer, player);
    const purchases = all(t).filter((e) => e.kind === 'buy-cards');
    expect(purchases).has.length(1);
    expect(purchases[0]).to.deep.include({generation: 2, verified: true});
    expect(purchases[0].cards).deep.eq(cards);
    expect(purchases[0].offeredCards).has.length(4);
    expect(all(t).filter((e) => e.kind === 'play-card')).is.empty;
    expect(all(t).find((e) => e.kind === 'pass')?.generation).eq(1);
  });

  it('keeps the order in which two cards were played, with cost and payment', () => {
    const {player} = newSolo(undefined, 'solo-tl-order');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    play(tracer, player, CardName.SPONSORS);
    play(tracer, player, CardName.EARTH_OFFICE);
    const t = timeline(tracer, player);
    expect(t.history).eq('valid');
    const plays = all(t).filter((e) => e.kind === 'play-card');
    expect(plays.map((e) => e.cards[0])).deep.eq([CardName.SPONSORS, CardName.EARTH_OFFICE]);
    expect(plays.map((e) => e.order)).deep.eq([1, 2]);
    expect(plays[0]).to.deep.include({cost: 6, verified: true});
    expect(plays[0].payment).deep.eq({megacredits: 6});
    expect(plays[0].before?.megacredits).eq(40);
    expect(plays[0].after?.megacredits).eq(34);
    expect(plays[0].after?.production.megacredits).eq((plays[0].before?.production.megacredits ?? 0) + 2);
  });

  it('counts each recorded decision once, even if a line is duplicated', () => {
    const {game, player} = newSolo(undefined, 'solo-tl-dup');
    setHand(player, [CardName.SPONSORS], 40);
    play(tracer, player, CardName.SPONSORS);
    const records = sink.read(game.id, 'trace').records as Array<CoachTraceEvent>;
    sink.append(game.id, 'trace', records[records.length - 1]);
    const first = timeline(tracer, player);
    expect(all(first).filter((e) => e.kind === 'play-card')).has.length(1);
    expect(timeline(tracer, player)).deep.eq(first);
  });

  it('is off for games with several players and says when the history is off', () => {
    const alice = TestPlayer.BLUE.newPlayer();
    const bob = TestPlayer.RED.newPlayer();
    Game.newInstance('game-solo-tl-2p', [alice, bob], alice, 'spectator-tl-2p');
    expect(timeline(tracer, alice)).to.deep.include({status: 'not-solo', generations: []});
    const {player} = newSolo(tracer, 'solo-tl-off');
    const off = timeline(undefined, player);
    expect(off).to.deep.include({status: 'disabled', history: 'disabled'});
    expect(off.generations).is.empty;
  });

  it('builds the same timeline again after a server restart (files)', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-timeline-'));
    const first = new CoachTracer(fileSink(directory));
    const {player} = newSolo(undefined, 'solo-tl-restart');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    pass(first, player);
    const research = root(projectCoachState(player));
    act(first, player, {type: 'card', cards: research.cards!.slice(0, 2).map((c) => c.name)});
    play(first, player, CardName.SPONSORS);
    const before = timeline(first, player);
    // A new process: a fresh tracer on the same directory.
    const second = new CoachTracer(fileSink(directory));
    const after = timeline(second, player);
    expect(after).deep.eq(before);
    expect(all(after).map((e) => e.kind)).deep.eq(['pass', 'buy-cards', 'play-card']);
    // And it continues the history.
    play(second, player, CardName.EARTH_OFFICE);
    expect(all(timeline(second, player)).filter((e) => e.kind === 'play-card').map((e) => e.cards[0])).deep.eq([CardName.SPONSORS, CardName.EARTH_OFFICE]);
    fs.rmSync(directory, {recursive: true, force: true});
  });

  it('serves the timeline read-only through the route', async () => {
    const {game, player} = newSolo(tracer, 'solo-tl-route', 1);
    setCoachTracer(tracer);
    const scaffolding = new RouteTestScaffolding();
    await scaffolding.ctx.gameLoader.add(game);
    const serialized = JSON.stringify(game.serialize());
    const traceLength = sink.read(game.id, 'trace').records.length;
    const res = new MockResponse();
    scaffolding.url = `/api/coach/timeline?id=${player.id}`;
    await scaffolding.get(ApiCoachTimeline.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.ok);
    expect(res.headers.get('Cache-Control')).eq('no-store');
    const body: CoachTimelineV1 = JSON.parse(res.content);
    expect(body.schemaVersion).eq('coach-timeline/1');
    expect(body.generations[0].events[0].kind).eq('initial-selection');
    expectNoSecretIds(body, game);
    // Reading changes neither the game nor the history.
    expect(JSON.stringify(game.serialize())).eq(serialized);
    expect(sink.read(game.id, 'trace').records.length).eq(traceLength);
  });

  it('tells standard projects, sales, passes and other options apart', () => {
    const projects = {path: '1', inputType: 'projectCard', title: 'Standard projects', buttonLabel: 'Confirm', optional: false, cards: [{name: CardName.POWER_PLANT_STANDARD_PROJECT, calculatedCost: 11, inCatalog: true}]};
    const sell = {path: '2', inputType: 'card', title: 'Sell patents', buttonLabel: 'Sell', optional: false, cards: [], min: 1, max: 2};
    const passOption = {path: '3', inputType: 'option', title: 'Pass for this generation', buttonLabel: 'Pass', optional: false};
    const heat = {path: '4', inputType: 'option', title: 'Convert 8 heat into temperature', buttonLabel: 'Convert', optional: false};
    const menu = {path: '', inputType: 'or', title: 'Take your first action', buttonLabel: 'Take action', optional: false, options: [heat, projects, sell, passOption, heat]};
    const kind = (index: number, response: object) => normalizeDecision(menu as never, {type: 'or', index, response} as never);
    expect(kind(1, {type: 'projectCard', card: CardName.POWER_PLANT_STANDARD_PROJECT, payment: {megacredits: 11}})).to.deep.include({kind: 'standard-project', cost: 11});
    expect(kind(2, {type: 'card', cards: [CardName.MINE, CardName.ALGAE]})).to.deep.include({kind: 'sell-patents', cards: [CardName.MINE, CardName.ALGAE]});
    expect(kind(3, {type: 'option'}).kind).eq('pass');
    expect(kind(0, {type: 'option'})).to.deep.include({kind: 'game-option', label: 'Convert 8 heat into temperature'});
    expect(normalizeDecision(undefined, {type: 'option'}).kind).eq('other');
  });
});

// Undo through the real input route: the game is restored from its last save as a new Game object.
describe('solo timeline with undo (P3-SOLO-1)', () => {
  let scaffolding: RouteTestScaffolding;
  let database: InMemoryDatabase;
  let tracer: CoachTracer;
  let sink: ReturnType<typeof memorySink>;

  beforeEach(() => {
    database = new InMemoryDatabase();
    setTestDatabase(database);
    const loader = GameLoader.newTestInstance({sleepMillis: 0, evictMillis: 100, idleMillis: 1000, sweep: 'manual'}, new FakeClock());
    setTestGameLoader(loader);
    loader.resetForTesting();
    scaffolding = new RouteTestScaffolding();
    scaffolding.ctx.gameLoader = loader;
    sink = memorySink();
    tracer = new CoachTracer(sink);
    addInputObserver(tracer.observer);
  });

  afterEach(() => {
    removeInputObserver(tracer.observer);
    restoreTestDatabase();
    restoreTestGameLoader();
  });

  async function send(playerId: string, body: InputResponse): Promise<MockResponse> {
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
    return res;
  }

  async function current(playerId: string): Promise<IPlayer> {
    const game = await scaffolding.ctx.gameLoader.getGame(playerId as never);
    return game!.getPlayerById(playerId as never);
  }

  async function playThroughRoute(playerId: string, card: CardName) {
    const player = await current(playerId);
    const menu = root(projectCoachState(player));
    const index = menu.options!.findIndex((o) => o.title === 'Play project card');
    const cost = menu.options![index].cards!.find((c) => c.name === card)!.calculatedCost!;
    const res = await send(playerId, {type: 'or', index, response: {type: 'projectCard', card, payment: Payment.of({megacredits: cost})}});
    expect(res.statusCode).eq(statusCode.ok);
  }

  it('evaluates only the current line of play after an undo', async () => {
    const {game, player} = newSolo(undefined, 'game-solo-tl-undo');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    await tick();
    await scaffolding.ctx.gameLoader.add(game);
    await playThroughRoute(player.id, CardName.SPONSORS);
    const afterPlay = await current(player.id);
    const undo = root(projectCoachState(afterPlay)).options!.findIndex((o) => o.title === 'Undo last action');
    expect(undo).greaterThanOrEqual(0);
    expect((await send(player.id, {type: 'or', index: undo, response: {type: 'option'}})).statusCode).eq(statusCode.ok);
    await playThroughRoute(player.id, CardName.EARTH_OFFICE);

    const live = await current(player.id);
    expect(live.game).not.eq(game);
    const t = timeline(tracer, live);
    expect(all(t).filter((e) => e.kind === 'play-card').map((e) => e.cards[0])).deep.eq([CardName.EARTH_OFFICE]);
    expect(all(t).find((e) => e.kind === 'play-card')?.order).eq(1);
    expect(t.superseded.map((e) => e.cards[0])).deep.eq([CardName.SPONSORS]);
    expect(t.superseded[0].order).is.undefined;
    expect(all(t).some((e) => e.kind === 'undo')).is.true;
  });
});
