import {expect} from 'chai';
import {CoachTracer, memorySink, setCoachTracer} from '../../../../src/extensions/coach/server/coachTrace';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {buildFindings} from '../../../../src/extensions/coach/server/solo/evaluator';
import {parseReflectionRequest, questionContext, reflect} from '../../../../src/extensions/coach/server/solo/reflection';
import {upcomingHints} from '../../../../src/extensions/coach/server/solo/prospective';
import {ApiCoachFindings, ApiCoachReflection} from '../../../../src/extensions/coach/server/routes';
import {CoachFindingsV1} from '../../../../src/extensions/coach/common/CoachFindings';
import {CoachReflectionRequest, CoachReflectionV1} from '../../../../src/extensions/coach/common/CoachReflection';
import {CardName} from '../../../../src/common/cards/CardName';
import {IPlayer} from '../../../../src/server/IPlayer';
import {statusCode} from '../../../../src/common/http/statusCode';
import {RouteTestScaffolding} from '../../../routes/RouteTestScaffolding';
import {MockRequest, MockResponse} from '../../../routes/HttpMocks';
import {newSolo, play, setHand} from './soloTestUtils';

function findings(tracer: CoachTracer, player: IPlayer, upcoming = false): CoachFindingsV1 {
  const state = projectCoachState(player);
  return buildFindings({tracer, gameId: player.game.id, color: player.color, state, history: () => 'valid'}, {upcoming});
}

function request(findingId: string, answers: Array<string>, view: CoachReflectionRequest['view'] = 'question'): CoachReflectionRequest {
  return {schemaVersion: 'coach-reflection-request/1', findingId, answers, view};
}

function step(f: CoachFindingsV1, r: CoachReflectionRequest): CoachReflectionV1 {
  const result = reflect(f, r);
  if (typeof result === 'string') {
    throw new Error(result);
  }
  return result;
}

const text = (labels: ReadonlyArray<{template: string, params: ReadonlyArray<{text: string}>}> | undefined) =>
  (labels ?? []).map((l) => l.template.replace(/\$\{(\d)\}/g, (_, i) => l.params[Number(i)]?.text ?? '')).join(' | ');

// P3-SOLO-3: step-by-step reflection on a finding.
describe('solo reflection (P3-SOLO-3)', () => {
  let tracer: CoachTracer;
  let player: IPlayer;
  let found: CoachFindingsV1;
  let id: string;

  beforeEach(() => {
    tracer = new CoachTracer(memorySink());
    ({player} = newSolo(undefined, 'solo-rf'));
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    play(tracer, player, CardName.SPONSORS);
    play(tracer, player, CardName.EARTH_OFFICE);
    found = findings(tracer, player);
    id = found.findings.find((f) => f.kind === 'play-order-discount' && f.intervention)!.id;
  });

  afterEach(() => setCoachTracer(undefined));

  it('asks first why, without giving the answer away (Gate A)', () => {
    const a = step(found, request(id, []));
    expect(a).to.deep.include({status: 'ok', gate: 'A', kind: 'play-order-discount'});
    expect(text([a.about!])).eq('Generation 1: you played Sponsors, then Earth Office');
    expect(text([a.question!])).eq('What made you play Sponsors before Earth Office?');
    expect(a.lines).is.undefined;
    const json = JSON.stringify(a);
    // No amount, no alternative order, no verdict.
    expect(json).does.not.match(/\b3\b|\b4\b|\b7\b|cheaper|less|Earth Office then Sponsors|better|mistake/);
  });

  it('lets the next question follow the answer (Gate B)', () => {
    expect(text([step(found, request(id, ['a.no-order'])).question!])).eq('When you play several cards in one generation, what can their order change?');
    expect(text([step(found, request(id, ['a.decided-later'])).question!])).eq('When you played Sponsors, could you already have played Earth Office?');
    expect(text([step(found, request(id, ['a.needed-first'])).question!])).eq('Does Earth Office change what other cards in your hand cost?');
  });

  it('shows the evidence at Gate C and the comparison only when asked for', () => {
    const c = step(found, request(id, ['a.no-order', 'b.cost']));
    expect(c.gate).eq('C');
    expect(text(c.lines)).contains('Earth Office was playable when you played Sponsors');
    expect(text(c.lines)).contains('Earth Office lowers the cost of Sponsors from 6 to 3 M€');
    expect(text(c.lines)).does.not.contain('less in total');
    const done = step(found, request(id, ['a.no-order', 'b.cost', 'c.different']));
    expect(done.gate).eq('done');
    const explain = step(found, request(id, [], 'explain'));
    expect(text(explain.lines)).contains('The alternative costs 3 M€ less in total (4 instead of 7)');
    expect(text(explain.lines)).contains('Only this point of view is compared');
  });

  it('gives hints and rules without the conclusion', () => {
    const hint = step(found, request(id, [], 'hint'));
    expect(text(hint.lines)).eq('Look at what each card does to the cost of the other cards you play in the same generation.');
    const rules = step(found, request(id, ['a.other'], 'rules'));
    expect(text(rules.lines)).contains('A discount only applies to cards played after the card that gives it.');
    expect(JSON.stringify([hint, rules])).does.not.match(/\b3\b|\b7\b/);
  });

  it('keeps the questioner apart from the verdict', () => {
    const finding = found.findings.find((f) => f.id === id)!;
    const context = questionContext(finding);
    expect(Object.keys(context).sort()).deep.eq(['cards', 'generation', 'kind']);
    expect(context.cards).deep.eq([CardName.SPONSORS, CardName.EARTH_OFFICE]);
  });

  it('refuses answers that do not fit the questions and unknown findings', () => {
    expect(reflect(found, request(id, ['c.same']))).is.a('string');
    expect(reflect(found, request(id, ['a.no-order', 'b.yes-no']))).is.a('string');
    expect(step(found, request('0'.repeat(16), []))).to.deep.include({status: 'gone'});
    for (const bad of [{...request(id, []), extra: 1}, {...request(id, []), findingId: 'x'}, {...request(id, ['A'])}, {...request(id, ['a.x', 'a.y', 'a.z', 'a.w'])}, {...request(id, []), view: 'answer'}]) {
      expect(parseReflectionRequest(JSON.stringify(bad)), JSON.stringify(bad)).is.a('string');
    }
    expect(parseReflectionRequest(JSON.stringify(request(id, ['a.no-order'])))).is.an('object');
  });

  it('serves the reflection through the route (same origin, read-only)', async () => {
    setCoachTracer(tracer);
    const scaffolding = new RouteTestScaffolding(new MockRequest());
    await scaffolding.ctx.gameLoader.add(player.game);
    const serialized = JSON.stringify(player.game.serialize());
    const post = async (body: object, headers: Record<string, string> = {'content-type': 'application/json', 'sec-fetch-site': 'same-origin'}) => {
      const res = new MockResponse();
      scaffolding.req.headers = headers;
      scaffolding.url = `/api/coach/reflection?id=${player.id}`;
      const pending = scaffolding.post(ApiCoachReflection.INSTANCE, res);
      await new Promise((resolve) => setTimeout(resolve, 20));
      scaffolding.req.emitString(JSON.stringify(body));
      scaffolding.req.emitter.emit('end');
      await pending;
      return res;
    };
    const ok = await post(request(id, []));
    expect(ok.statusCode).eq(statusCode.ok);
    expect(ok.headers.get('Cache-Control')).eq('no-store');
    expect((JSON.parse(ok.content) as CoachReflectionV1).gate).eq('A');
    expect((await post(request(id, []), {'content-type': 'application/json', 'sec-fetch-site': 'cross-site'})).statusCode).eq(statusCode.forbidden);
    expect((await post(request(id, ['c.same']))).statusCode).eq(statusCode.badRequest);
    expect(JSON.stringify(player.game.serialize())).eq(serialized);
  });
});

describe('solo hints before acting (P3-SOLO-3)', () => {
  it('notices two playable cards whose order changes a cost, and nothing else', () => {
    const {player} = newSolo(undefined, 'solo-up');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    const [hint] = upcomingHints(projectCoachState(player));
    expect(hint).to.deep.include({kind: 'play-order-discount', cards: [CardName.EARTH_OFFICE, CardName.SPONSORS]});
    setHand(player, [CardName.SPONSORS, CardName.MINE], 40);
    expect(upcomingHints(projectCoachState(player))).is.empty;
  });

  it('adds hints to the findings only when asked for', async () => {
    const tracer = new CoachTracer(memorySink());
    const {game, player} = newSolo(undefined, 'solo-up-route');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    expect(findings(tracer, player).upcoming).is.undefined;
    expect(findings(tracer, player, true).upcoming).has.length(1);
    setCoachTracer(tracer);
    const scaffolding = new RouteTestScaffolding();
    await scaffolding.ctx.gameLoader.add(game);
    const res = new MockResponse();
    scaffolding.url = `/api/coach/findings?id=${player.id}&upcoming=1`;
    await scaffolding.get(ApiCoachFindings.INSTANCE, res);
    expect((JSON.parse(res.content) as CoachFindingsV1).upcoming).has.length(1);
    setCoachTracer(undefined);
  });
});
