import {expect} from 'chai';
import {ApiCoachCounsel, ApiCoachOptions, isSameOrigin} from '../../../../src/extensions/coach/server/routes';
import {choiceListFor, counsel, CounselLimiter, parseCounselRequest} from '../../../../src/extensions/coach/server/counsel/counselService';
import {aiSettings, AiSettings, setAiProviderForTesting} from '../../../../src/extensions/coach/server/counsel/aiConfig';
import {validateCounsel} from '../../../../src/extensions/coach/server/counsel/counselModel';
import {CoachLLMProvider, ProviderRequest, ProviderResult} from '../../../../src/extensions/coach/server/chat/providers/LLMProvider';
import {CoachChoiceListV1, CoachChoiceOption} from '../../../../src/extensions/coach/common/CoachChoiceList';
import {CoachCounselRequest, CoachCounselV1} from '../../../../src/extensions/coach/common/CoachCounsel';
import {RouteTestScaffolding} from '../../../routes/RouteTestScaffolding';
import {MockRequest, MockResponse} from '../../../routes/HttpMocks';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {Phase} from '../../../../src/common/Phase';
import {statusCode} from '../../../../src/common/http/statusCode';
import {newCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {SelectCard} from '../../../../src/server/inputs/SelectCard';
import {expectNoSecretIds} from '../coachTestUtils';

// P3-CD-1: options (Now / Future) and counsel. Scenario ids from docs/coach/phase3/choice-driven-plan.md §8.

const HAND = [CardName.EARTH_OFFICE, CardName.CARTEL, CardName.MINE, CardName.POWER_PLANT, CardName.ALGAE, CardName.LUNAR_BEAM, CardName.SPONSORS];
const OFF: AiSettings = {...aiSettings({}), enabled: false};
const ON: AiSettings = {...aiSettings({}), enabled: true, maxCalls: 100, perMinute: 100};

function actionPhase(game: IGame, player: TestPlayer, megacredits = 40) {
  game.phase = Phase.ACTION;
  player.cardsInHand.push(...HAND.map((name) => newCard(name) as IProjectCard));
  player.megaCredits = megacredits;
  player.takeAction();
}

function solo() {
  const [game, player] = testGame(1, {skipInitialCardSelection: true});
  actionPhase(game, player);
  return {game, player};
}

function list(player: TestPlayer, settings = OFF): CoachChoiceListV1 {
  return choiceListFor(player, settings).list;
}

function request(l: CoachChoiceListV1, option: CoachChoiceOption, extra: Partial<CoachCounselRequest> = {}): CoachCounselRequest {
  return {schemaVersion: 'coach-counsel-request/1', positionToken: l.positionToken, choiceId: option.id, compareWithChoiceId: null, mode: 'review', language: 'jp', aiConsent: false, ...extra};
}

function find(l: CoachChoiceListV1, kind: CoachChoiceOption['kind'], card?: string): CoachChoiceOption {
  const option = l.options.find((o) => o.kind === kind && (card === undefined || o.cardNames.includes(card)));
  if (option === undefined) {
    throw new Error(`no ${kind} ${card ?? ''}`);
  }
  return option;
}

/** A provider that answers with `reply` and records what it was sent. */
class FakeProvider implements CoachLLMProvider {
  public readonly id = 'fake';
  public readonly model = 'fake-model';
  public requests: Array<ProviderRequest> = [];
  constructor(private readonly answer: (r: ProviderRequest) => ProviderResult | Promise<ProviderResult>) {}
  public async generate(r: ProviderRequest): Promise<ProviderResult> {
    this.requests.push(r);
    return this.answer(r);
  }
}

function ok(reply: unknown): ProviderResult {
  return {ok: true, structuredReply: reply, usage: {}, elapsedMs: 5, model: 'fake-model'};
}

async function review(player: TestPlayer, option: CoachChoiceOption, extra: Partial<CoachCounselRequest> = {}, settings = OFF, provider?: CoachLLMProvider) {
  const l = list(player, settings);
  return counsel(player, request(l, option, extra), {settings, provider, limiter: new CounselLimiter()});
}

describe('coach options (P3-CD-1)', () => {
  it('CD01/CD02: lists exactly the playable cards of the game as project cards', () => {
    const {player} = solo();
    const l = list(player);
    expect(l.schemaVersion).eq('coach-choice-list/1');
    expect(l.stateStatus).eq('awaiting-input');
    const cards = l.options.filter((o) => o.kind === 'project-card').map((o) => o.cardNames[0]);
    expect(cards.sort()).deep.eq(player.getPlayableCards().map((c) => c.name).sort());
    for (const o of l.options.filter((x) => x.kind === 'project-card')) {
      expect(o.group).eq('now');
      expect(o.eligibility).eq('legal-now');
      expect(o.selectableForCoaching).is.true;
      expect(o.cost).eq(player.getCardCost(player.cardsInHand.find((c) => c.name === o.cardNames[0]) as IProjectCard));
    }
    // A card of the hand that the game does not offer is not a move.
    const unplayable = player.cardsInHand.filter((c) => !player.canPlay(c)).map((c) => c.name);
    expect(unplayable.length).greaterThan(0);
    expect(cards).to.not.include.members(unplayable);
  });

  it('lists only the standard projects that can be done now and counts the others', () => {
    const {player} = solo();
    player.megaCredits = 12;
    player.takeAction();
    const l = list(player);
    const projects = l.options.filter((o) => o.kind === 'standard-project');
    for (const o of projects) {
      expect(o.cost ?? 99).lessThanOrEqual(12);
      expect(o.limitations).includes('no-quantitative-analysis');
    }
    expect(l.omitted.find((x) => x.reason === 'standard-project-not-available')?.count).greaterThan(0);
  });

  it('CD03: keeps the branches of a nested or (funding an award) with their parent title', () => {
    const [game, player] = testGame(2, {skipInitialCardSelection: true});
    actionPhase(game, player);
    const l = list(player);
    const awards = l.options.filter((o) => o.parentLabel !== undefined);
    expect(awards.length).greaterThan(1);
    for (const o of awards) {
      expect(o.kind).eq('game-option');
      expect(o.parentLabel?.template).eq('Fund an award (${0} M€)');
    }
    expect(find(l, 'game-option').label.template).is.a('string');
    expect(l.options.some((o) => o.label.template === 'Pass for this generation')).is.true;
  });

  it('CD05: a purchase of cards is one selection, not a move per card', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.RESEARCH;
    const cards = [newCard(CardName.MINE), newCard(CardName.ALGAE), newCard(CardName.CARTEL)] as Array<IProjectCard>;
    player.setWaitingFor(new SelectCard('Select card(s) to buy', 'Buy', cards, {min: 0, max: 3}));
    const l = list(player);
    const now = l.options.filter((o) => o.group === 'now');
    expect(now).has.length(1);
    expect(now[0]).to.deep.include({kind: 'card-selection', eligibility: 'not-action', selectableForCoaching: false});
    expect(now[0].cardNames).deep.eq([CardName.MINE, CardName.ALGAE, CardName.CARTEL]);
    expect(l.options.some((o) => o.kind === 'project-card')).is.false;
  });

  it('CD08/CD09: no moves of the player while others act or after the game', () => {
    const [game, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    bob.cardsInHand.push(...HAND.map((name) => newCard(name) as IProjectCard));
    alice.takeAction();
    const waiting = list(bob);
    expect(waiting.stateStatus).eq('waiting-for-others');
    expect(waiting.options.filter((o) => o.group === 'now')).is.empty;
    game.phase = Phase.END;
    const over = list(alice);
    expect(over.stateStatus).eq('game-over');
    expect(over.options).is.empty;
  });

  it('CD10/CD11: plans are Future; a plan of several cards is never a move now', () => {
    const {player} = solo();
    const l = list(player);
    const plans = l.options.filter((o) => o.kind === 'strategy-plan');
    expect(plans.length).greaterThan(0);
    for (const o of plans) {
      expect(o.group).eq('future');
      if (o.cardNames.length > 1) {
        expect(o.eligibility).not.eq('legal-now');
        expect(o.limitations).includes('plan-not-one-move');
      }
    }
    // Without plans, the moves of the game are still listed.
    const [game2, other] = testGame(1, {skipInitialCardSelection: true});
    game2.phase = Phase.ACTION;
    other.takeAction();
    const none = list(other);
    expect(none.options.filter((o) => o.group === 'future')).is.empty;
    expect(none.options.filter((o) => o.group === 'now').length).greaterThan(0);
  });

  it('gives stable ids for one position, new ones after a move, and other tokens to other viewers', () => {
    const [game, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    actionPhase(game, alice);
    const first = list(alice);
    expect(list(alice)).deep.eq(first);
    expect(list(bob).positionToken).not.eq(first.positionToken);
    alice.megaCredits += 1;
    alice.takeAction();
    expect(list(alice).positionToken).not.eq(first.positionToken);
    expectNoSecretIds(first, game);
  });

  it('serves the list through the route, read-only', async () => {
    const {game, player} = solo();
    const scaffolding = new RouteTestScaffolding();
    await scaffolding.ctx.gameLoader.add(game);
    const before = JSON.stringify(game.serialize());
    const res = new MockResponse();
    scaffolding.url = `/api/coach/options?id=${player.id}`;
    await scaffolding.get(ApiCoachOptions.INSTANCE, res);
    expect(res.statusCode).eq(statusCode.ok);
    expect(res.headers.get('Cache-Control')).eq('no-store');
    const body: CoachChoiceListV1 = JSON.parse(res.content);
    expect(body.ai.available).is.a('boolean');
    expectNoSecretIds(body, game);
    expect(JSON.stringify(game.serialize())).eq(before);
    // CD19: a spectator id is refused.
    const spectator = new MockResponse();
    scaffolding.url = `/api/coach/options?id=${game.spectatorId}`;
    await scaffolding.get(ApiCoachOptions.INSTANCE, spectator);
    expect(spectator.statusCode).eq(statusCode.badRequest);
  });
});

describe('coach counsel (P3-CD-1)', () => {
  afterEach(() => setAiProviderForTesting(undefined));

  it('returns the facts of a chosen card without coaching in facts mode', async () => {
    const {player} = solo();
    const card = find(list(player), 'project-card');
    const outcome = await review(player, card, {mode: 'facts'});
    expect(outcome.status).eq(200);
    const body = outcome.body as CoachCounselV1;
    expect(body.source).eq('none');
    expect(body.strengths).is.empty;
    const cost = body.facts.find((f) => f.kind === 'cost');
    expect(cost?.value).to.deep.include({card: card.cardNames[0], cost: card.cost, megacredits: player.megaCredits});
    expect(body.facts.map((f) => f.id)).deep.eq(body.facts.map((_, i) => `F${i + 1}`));
  });

  it('CD20: coaches from templates when the model is off, every point with existing evidence', async () => {
    const {player} = solo();
    const l = list(player);
    for (const option of l.options.filter((o) => o.selectableForCoaching)) {
      const outcome = await review(player, option);
      const body = outcome.body as CoachCounselV1;
      expect(body.status).eq('ready');
      expect(body.source).eq('template');
      expect(body.ai.state).eq('off');
      const ids = new Set(body.facts.map((f) => f.id));
      const points = [...body.strengths, ...body.risks, ...body.outlook, ...(body.question ? [body.question] : [])];
      expect(points.length).greaterThan(0);
      for (const p of points) {
        expect(p.evidenceIds.length, JSON.stringify(p)).greaterThan(0);
        p.evidenceIds.forEach((id) => expect(ids.has(id), id).is.true);
        expect(JSON.stringify(p)).does.not.match(/best|optimal|勝率/i);
      }
      expect(body.question).is.not.undefined;
    }
  });

  it('CD13: names a cost that leaves little and says when no strength is shown', async () => {
    const {player} = solo();
    const project = find(list(player), 'standard-project');
    const body = (await review(player, project)).body as CoachCounselV1;
    expect(body.strengths[0].template?.template).eq('The facts show no clear strength of this choice');
    expect(body.risks.map((r) => r.template?.template)).includes('This choice is not analysed in numbers');
    expect(body.outlook.map((r) => r.template?.template)).includes('Paying ${0} M€ in M€ leaves ${1} M€');
  });

  it('CD12: never presents an incomplete forecast as a total', async () => {
    const {player} = solo();
    const l = list(player);
    for (const plan of l.options.filter((o) => o.kind === 'strategy-plan' && o.limitations.includes('forecast-incomplete'))) {
      const body = (await review(player, plan)).body as CoachCounselV1;
      const templates = [...body.strengths, ...body.risks].map((p) => p.template?.template);
      expect(templates).includes('Some effects are not modeled: totals are not shown');
      expect(templates).does.not.include('Paid back within this horizon');
    }
  });

  it('compares two options from the list', async () => {
    const {player} = solo();
    const l = list(player);
    const [a, b] = l.options.filter((o) => o.kind === 'project-card');
    const body = (await review(player, a, {compareWithChoiceId: b.id})).body as CoachCounselV1;
    expect(body.compareWithChoiceId).eq(b.id);
    expect(body.facts.some((f) => f.about === 'B' && f.kind === 'cost')).is.true;
    expect(body.question?.template?.template).eq('What does ${0} give you that ${1} does not, and what does it cost you?');
  });

  it('refuses stale tokens, unknown ids and options that cannot be coached', async () => {
    const {player} = solo();
    const l = list(player);
    const card = find(l, 'project-card');
    const stale = await counsel(player, request(l, card, {positionToken: '0'.repeat(32)}), {settings: OFF, limiter: new CounselLimiter()});
    expect(stale.status).eq(409);
    const unknown = await counsel(player, request(l, card, {choiceId: 'f'.repeat(16)}), {settings: OFF, limiter: new CounselLimiter()});
    expect(unknown.status).eq(400);
    const pass = l.options.find((o) => o.kind === 'undo' || o.kind === 'blue-action' || o.kind === 'card-selection');
    if (pass !== undefined) {
      expect((await counsel(player, request(l, pass), {settings: OFF, limiter: new CounselLimiter()})).status).eq(400);
    }
  });

  it('CD15: leaves the game exactly as it was', async () => {
    const {game, player} = solo();
    const before = JSON.stringify(game.serialize());
    const l = list(player);
    for (const option of l.options.filter((o) => o.selectableForCoaching)) {
      await review(player, option);
    }
    expect(JSON.stringify(game.serialize())).eq(before);
  });

  describe('with the model', () => {
    function validAnswer(r: ProviderRequest) {
      const input = r.task?.input as {facts: Array<{id: string, kind: string, value: {cost?: number}}>};
      const cost = input.facts.find((f) => f.kind === 'cost');
      const id = cost?.id ?? input.facts[0].id;
      return ok({
        strengths: [],
        risks: [{about: 'A', text: cost ? `費用は ${cost.value.cost} M€ です。` : '注意点があります。', evidence: [id]}],
        outlook: [],
        question: {text: 'この世代で何を終えたいですか？', evidence: [id]},
      });
    }

    it('does not call the model without consent (CD20)', async () => {
      const {player} = solo();
      const provider = new FakeProvider(validAnswer);
      const body = (await review(player, find(list(player, ON), 'project-card'), {aiConsent: false}, ON, provider)).body as CoachCounselV1;
      expect(provider.requests).is.empty;
      expect(body.ai.state).eq('no-consent');
      expect(body.source).eq('template');
    });

    it('uses a checked model answer and sends no ids (CD25)', async () => {
      const {game, player} = solo();
      const provider = new FakeProvider(validAnswer);
      const l = list(player, ON);
      const card = find(l, 'project-card');
      const body = (await counsel(player, request(l, card, {aiConsent: true}), {settings: ON, provider, limiter: new CounselLimiter()})).body as CoachCounselV1;
      expect(body.source).eq('model');
      expect(body.status).eq('ready');
      expect(body.risks[0].text).contains('M€');
      const sent = JSON.stringify(provider.requests[0].task);
      expectNoSecretIds(provider.requests[0].task, game);
      expect(sent).does.not.contain(l.positionToken);
      for (const o of l.options) {
        expect(sent).does.not.contain(o.id);
      }
    });

    it('CD21/CD22: falls back to templates on a failure or a refused answer', async () => {
      const {player} = solo();
      const card = find(list(player, ON), 'project-card');
      const answers: Array<ProviderResult> = [
        {ok: false, category: 'timeout', detail: 'after 1 ms', elapsedMs: 1, model: 'm'},
        {ok: false, category: 'rate-limit', detail: 'HTTP 429', elapsedMs: 1, model: 'm'},
        ok('not json'),
        ok({strengths: [{about: 'A', text: '12345 M€ 得します', evidence: ['F1']}], risks: [], outlook: [], question: {text: '?', evidence: ['F1']}}),
        ok({strengths: [{about: 'A', text: '強い', evidence: ['F99']}], risks: [], outlook: [], question: {text: '?', evidence: ['F1']}}),
        ok({strengths: [{about: 'A', text: 'これが最適解です', evidence: ['F1']}], risks: [], outlook: [], question: {text: '?', evidence: ['F1']}}),
      ];
      for (const answer of answers) {
        const body = (await review(player, card, {aiConsent: true}, ON, new FakeProvider(() => answer))).body as CoachCounselV1;
        expect(body.status, JSON.stringify(answer)).eq('fallback');
        expect(body.source).eq('template');
        expect(body.ai.state).eq('failed');
        expect(body.strengths.length + body.risks.length).greaterThan(0);
      }
    });

    it('stops calling the model when the budget is spent (CD15 budget)', async () => {
      const {player} = solo();
      const provider = new FakeProvider(validAnswer);
      const settings = {...ON, maxCalls: 1};
      const limiter = new CounselLimiter();
      const l = list(player, settings);
      const card = find(l, 'project-card');
      await counsel(player, request(l, card, {aiConsent: true}), {settings, provider, limiter});
      const second = (await counsel(player, request(l, card, {aiConsent: true}), {settings, provider, limiter})).body as CoachCounselV1;
      expect(provider.requests).has.length(1);
      expect(second.ai).deep.include({state: 'failed', category: 'budget'});
    });

    it('CD17: an answer made while the game moved on is stale', async () => {
      const {player} = solo();
      const provider = new FakeProvider((r) => {
        player.megaCredits += 5;
        player.takeAction();
        return validAnswer(r);
      });
      const body = (await review(player, find(list(player, ON), 'project-card'), {aiConsent: true}, ON, provider)).body as CoachCounselV1;
      expect(body.status).eq('stale');
      expect(body.strengths).is.empty;
      expect(body.facts).is.empty;
    });

    it('checks numbers and card names against the cited facts only', () => {
      const {player} = solo();
      const l = list(player);
      const built = choiceListFor(player, OFF);
      const card = find(l, 'project-card');
      const entry = built.entries.get(card.id);
      if (entry === undefined) {
        throw new Error('entry');
      }
      const facts = [
        {id: 'F1', about: 'game' as const, kind: 'resources' as const, value: {megacredits: 40}, support: 'verified' as const},
        {id: 'F2', about: 'A' as const, kind: 'cost' as const, value: {card: card.cardNames[0], cost: 7}, support: 'verified' as const},
      ];
      const cite = (text: string, evidence: Array<string>) => validateCounsel({strengths: [{about: 'A', text, evidence}], risks: [], outlook: [], question: {text: '?', evidence: ['F1']}}, facts, entry, undefined);
      expect(cite('費用は 7 M€', ['F2']).ok).is.true;
      // 40 is in the input, but not in the fact this point cites.
      expect(cite('残りは 40 M€', ['F2']).ok).is.false;
      expect(cite('Giant Space Mirror と組み合わせる', ['F2']).ok).is.false;
      expect(cite('B は良い', ['F2']).ok).is.true;
      expect(validateCounsel({strengths: [{about: 'B', text: 'x', evidence: ['F2']}], risks: [], outlook: [], question: {text: '?', evidence: ['F1']}}, facts, entry, undefined).ok).is.false;
    });
  });
});

describe('coach counsel route (P3-CD-1)', () => {
  async function post(scaffolding: RouteTestScaffolding, body: string, headers: Record<string, string> = {'content-type': 'application/json', 'sec-fetch-site': 'same-origin'}) {
    const res = new MockResponse();
    scaffolding.req.headers = {...headers};
    const response = scaffolding.post(ApiCoachCounsel.INSTANCE, res);
    // The mock request does not buffer: send the body once the handler reads it (after loading the game).
    await new Promise((resolve) => setTimeout(resolve, 20));
    scaffolding.req.emitString(body);
    scaffolding.req.emitter.emit('end');
    await response;
    return res;
  }

  it('answers a same-origin JSON request and refuses the rest', async () => {
    const {game, player} = solo();
    const scaffolding = new RouteTestScaffolding(new MockRequest());
    await scaffolding.ctx.gameLoader.add(game);
    scaffolding.url = `/api/coach/counsel?id=${player.id}`;
    const l = list(player);
    const body = JSON.stringify(request(l, find(l, 'project-card')));
    const res = await post(scaffolding, body);
    expect(res.statusCode).eq(statusCode.ok);
    expect(res.headers.get('Cache-Control')).eq('no-store');
    expect((JSON.parse(res.content) as CoachCounselV1).schemaVersion).eq('coach-counsel/1');

    expect((await post(scaffolding, body, {'content-type': 'application/json', 'sec-fetch-site': 'cross-site'})).statusCode).eq(statusCode.forbidden);
    expect((await post(scaffolding, body, {'content-type': 'text/plain', 'sec-fetch-site': 'same-origin'})).statusCode).eq(statusCode.badRequest);
    expect((await post(scaffolding, '{"schemaVersion": 1}')).statusCode).eq(statusCode.badRequest);
    const stale = await post(scaffolding, JSON.stringify(request(l, find(l, 'project-card'), {positionToken: 'a'.repeat(32)})));
    expect(stale.statusCode).eq(409);
    expect(JSON.parse(stale.content).status).eq('stale');
  });

  it('accepts only the documented request fields', () => {
    const good = {schemaVersion: 'coach-counsel-request/1', positionToken: 'a'.repeat(32), choiceId: 'b'.repeat(16), mode: 'review', language: 'jp', aiConsent: false};
    expect(parseCounselRequest(JSON.stringify(good))).is.an('object');
    for (const bad of [
      {...good, extra: 1}, {...good, positionToken: 'x'}, {...good, choiceId: 'B'.repeat(16)}, {...good, mode: 'chat'},
      {...good, language: 'japanese'}, {...good, aiConsent: 'yes'}, {...good, compareWithChoiceId: 'b'.repeat(16)}, [],
    ]) {
      expect(parseCounselRequest(JSON.stringify(bad)), JSON.stringify(bad)).is.a('string');
    }
  });

  it('tells same-origin requests from cross-site ones', () => {
    const req = (headers: Record<string, string>) => ({headers} as unknown as MockRequest);
    expect(isSameOrigin(req({'sec-fetch-site': 'same-origin'}))).is.true;
    expect(isSameOrigin(req({'sec-fetch-site': 'cross-site'}))).is.false;
    expect(isSameOrigin(req({origin: 'https://evil.example', host: 'tm.local:8081'}))).is.false;
    expect(isSameOrigin(req({origin: 'http://tm.local:8081', host: 'tm.local:8081'}))).is.true;
  });

  it('allows one review at a time and a limit per minute per player', () => {
    const limiter = new CounselLimiter();
    expect(limiter.begin('p', 2, 0)).eq('ok');
    expect(limiter.begin('p', 2, 1)).eq('busy');
    limiter.end('p');
    expect(limiter.begin('p', 2, 2)).eq('ok');
    limiter.end('p');
    expect(limiter.begin('p', 2, 3)).eq('rate');
    expect(limiter.begin('p', 2, 60001)).eq('ok');
    expect(limiter.begin('q', 2, 3)).eq('ok');
  });

  it('keeps the model off unless the server enables it and has a key', () => {
    expect(aiSettings({}).enabled).is.false;
    expect(aiSettings({COACH_AI_ENABLED: 'true', OPENAI_API_KEY: 'k'}).enabled).is.false;
    expect(aiSettings({COACH_AI_ENABLED: 'true', COACH_AI_EXTERNAL_ALLOWED: 'true'}).enabled).is.false;
    expect(aiSettings({COACH_AI_ENABLED: 'true', COACH_AI_EXTERNAL_ALLOWED: 'true', OPENAI_API_KEY: 'k'})).to.deep.include({enabled: true, model: 'gpt-6.1-sol'});
    expect(aiSettings({COACH_AI_ENABLED: 'true', COACH_AI_EXTERNAL_ALLOWED: 'true', COACH_AI_PROVIDER: 'sarashina', SARASHINA_API_KEY: 'k'})).to.deep.include({enabled: true, model: 'sarashina3-mini'});
  });
});

