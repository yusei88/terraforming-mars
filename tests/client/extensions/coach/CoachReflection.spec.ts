import {flushPromises, mount, VueWrapper} from '@vue/test-utils';
import {expect} from 'chai';
import {globalConfig} from '../../components/getLocalVue';
import CoachPanel from '@/extensions/coach/client/CoachPanel.vue';
import {coachPanelState} from '@/extensions/coach/client/coachPanelState';
import {coachSoloState} from '@/extensions/coach/client/coachSoloState';
import {CoachFindingsV1, CoachFindingV1} from '@/extensions/coach/common/CoachFindings';
import {CoachReflectionRequest, CoachReflectionV1} from '@/extensions/coach/common/CoachReflection';
import {ViewModel} from '@/common/models/PlayerModel';
import {CardName} from '@/common/cards/CardName';

const card = (name: string) => ({text: name, card: true});

function finding(id: string, extra: Partial<CoachFindingV1> = {}): CoachFindingV1 {
  return {
    id: id.padEnd(16, '0'), kind: 'play-order-discount', decision: {eventId: 's3', seq: 3, generation: 2}, related: ['s4'],
    actual: {summary: {template: '${0} then ${1}', params: [card(CardName.SPONSORS), card(CardName.EARTH_OFFICE)]}, megacredits: 7},
    alternative: {summary: {template: '${0} then ${1}', params: [card(CardName.EARTH_OFFICE), card(CardName.SPONSORS)]}, megacredits: 4},
    difference: {megacredits: 3}, evidence: [], confidence: 'verified', unmodeled: [], limits: [], intervention: true, severity: 'notable', ...extra,
  };
}

function findingsBody(findings: Array<CoachFindingV1>, upcoming?: CoachFindingsV1['upcoming']): CoachFindingsV1 {
  return {schemaVersion: 'coach-findings/1', status: 'ok', solo: {victory: 'terraform', lastGeneration: 14}, findings, checked: [], ...(upcoming === undefined ? {} : {upcoming})};
}

function step(request: CoachReflectionRequest): CoachReflectionV1 {
  const base = {schemaVersion: 'coach-reflection/1', findingId: request.findingId, status: 'ok', kind: 'play-order-discount', view: request.view,
    about: {template: 'Generation ${0}: you played ${1}, then ${2}', params: [{text: '2'}, card(CardName.SPONSORS), card(CardName.EARTH_OFFICE)]}} as const;
  if (request.view === 'explain') {
    return {...base, lines: [{template: 'The alternative costs ${0} M€ less in total (${1} instead of ${2})', params: [{text: '3'}, {text: '4'}, {text: '7'}]}]};
  }
  if (request.view === 'hint') {
    return {...base, lines: [{template: 'Look at what each card does to the cost of the other cards you play in the same generation.', params: []}]};
  }
  switch (request.answers.length) {
  case 0:
    return {...base, gate: 'A', question: {template: 'What made you play ${0} before ${1}?', params: [card(CardName.SPONSORS), card(CardName.EARTH_OFFICE)]},
      options: [{key: 'a.no-order', label: {template: 'I did not think about the order', params: []}}]};
  case 1:
    return {...base, gate: 'B', question: {template: 'When you play several cards in one generation, what can their order change?', params: []},
      options: [{key: 'b.cost', label: {template: 'What the cards cost', params: []}}]};
  case 2:
    return {...base, gate: 'C', question: {template: 'With these facts, would you make the same choice again?', params: []},
      lines: [{template: '${0} lowers the cost of ${1} from ${2} to ${3} M€', params: [card(CardName.EARTH_OFFICE), card(CardName.SPONSORS), {text: '6'}, {text: '3'}]}],
      options: [{key: 'c.different', label: {template: 'I would do it differently', params: []}}]};
  default:
    return {...base, gate: 'done', question: {template: 'Thank you. You can open the comparison with the alternative if you want.', params: []}, options: []};
  }
}

const soloView = (gameAge = 1) => ({id: 'p123', thisPlayer: {}, players: [{}], game: {gameAge, undoCount: 0, step: gameAge, phase: 'action', generation: 2}}) as unknown as ViewModel;

describe('CoachWatcher and reflection (P3-SOLO-3)', () => {
  let current: () => CoachFindingsV1;
  let requests: Array<{url: string, body?: CoachReflectionRequest}>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.removeItem('coach.solo');
    Object.assign(coachSoloState, {handled: [], later: [], watch: true, before: false, findings: undefined, reflectionId: undefined, tab: 'choices'});
    coachPanelState.open = false;
    requests = [];
    current = () => findingsBody([]);
    global.fetch = (async (input: unknown, init?: {body?: string}) => {
      const url = String(input);
      const body = init?.body === undefined ? undefined : JSON.parse(init.body) as CoachReflectionRequest;
      requests.push({url, body});
      if (url.startsWith('api/coach/findings')) {
        return new Response(JSON.stringify(current()), {status: 200});
      }
      if (url.startsWith('api/coach/reflection')) {
        return new Response(JSON.stringify(step(body as CoachReflectionRequest)), {status: 200});
      }
      return new Response(JSON.stringify({schemaVersion: 'coach-choice-list/1', positionToken: 'a'.repeat(32), analysisVersion: '2', stateStatus: 'awaiting-input', options: [], omitted: [], ai: {available: false}, warnings: []}), {status: 200});
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    coachPanelState.open = false;
  });

  async function start(view = soloView()): Promise<VueWrapper> {
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view}});
    await flushPromises();
    return wrapper;
  }

  async function move(wrapper: VueWrapper, gameAge: number) {
    await wrapper.setProps({view: soloView(gameAge)});
    await flushPromises();
  }

  it('shows the watching indicator and counts findings that existed, without a cut-in', async () => {
    current = () => findingsBody([finding('a')]);
    const wrapper = await start();
    expect(wrapper.find('[data-test=watch-indicator]').text()).contains('G2');
    expect(wrapper.find('[data-test=watch-unread]').text()).eq('1');
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
  });

  it('cuts in once after a move with a new notable finding, asking first why', async () => {
    const wrapper = await start();
    current = () => findingsBody([finding('b')]);
    await move(wrapper, 2);
    const cutIn = wrapper.find('[data-test=cut-in]');
    expect(cutIn.text()).contains('Looking back');
    expect(cutIn.text()).contains('What made you play Sponsors before Earth Office?');
    expect(cutIn.text()).does.not.match(/3 M€|cheaper|less/);
    // Later: no cut-in again, still unread.
    await cutIn.find('[data-test=cut-in-later]').trigger('click');
    await move(wrapper, 3);
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
    expect(wrapper.find('[data-test=watch-unread]').text()).eq('1');
  });

  it('does not cut in for minor findings', async () => {
    const wrapper = await start();
    current = () => findingsBody([finding('c', {severity: 'minor'})]);
    await move(wrapper, 2);
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
    expect(wrapper.find('[data-test=watch-unread]').text()).eq('1');
  });

  it('closes a cut-in for good', async () => {
    const wrapper = await start();
    current = () => findingsBody([finding('d')]);
    await move(wrapper, 2);
    await wrapper.find('[data-test=cut-in-close]').trigger('click');
    await move(wrapper, 3);
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
    expect(wrapper.find('[data-test=watch-unread]').exists()).is.false;
    expect(JSON.parse(localStorage.getItem('coach.solo')!).handled).deep.eq([finding('d').id]);
  });

  it('guides through Gate A, B and C, with the comparison only when asked for', async () => {
    const wrapper = await start();
    current = () => findingsBody([finding('e')]);
    await move(wrapper, 2);
    await wrapper.find('[data-test=cut-in-open]').trigger('click');
    await flushPromises();
    expect(coachPanelState.open).is.true;
    expect(wrapper.find('[data-test=reflect-question]').text()).eq('What made you play Sponsors before Earth Office?');
    expect(wrapper.text()).does.not.contain('less in total');
    await wrapper.find('[data-test=reflect-option]').trigger('click');
    await flushPromises();
    expect(requests.at(-1)?.body?.answers).deep.eq(['a.no-order']);
    expect(wrapper.find('[data-test=reflect-question]').text()).contains('what can their order change');
    await wrapper.find('[data-test=reflect-option]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test=reflect-lines]').text()).contains('Earth Office lowers the cost of Sponsors from 6 to 3 M€');
    await wrapper.find('[data-test=reflect-hint]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test=reflect-extra]').text()).contains('Look at what each card does');
    await wrapper.find('[data-test=reflect-explain]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test=reflect-extra]').text()).contains('The alternative costs 3 M€ less in total (4 instead of 7)');
    expect(coachSoloState.handled).includes(finding('e').id);
  });

  it('offers hints before acting only when turned on, and drops them when the position changes', async () => {
    current = () => findingsBody([], [{id: 'f'.repeat(16), kind: 'play-order-discount', cards: [CardName.EARTH_OFFICE, CardName.SPONSORS]}]);
    const wrapper = await start();
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
    expect(requests[0].url).contains('upcoming=0');
    coachSoloState.before = true;
    await flushPromises();
    expect(requests.at(-1)?.url).contains('upcoming=1');
    expect(wrapper.find('[data-test=cut-in]').text()).contains('can change what they cost');
    expect(wrapper.find('[data-test=cut-in-cards]').exists()).is.false;
    await wrapper.find('[data-test=cut-in-reveal]').trigger('click');
    expect(wrapper.find('[data-test=cut-in-cards]').text()).eq('Look at Earth Office and Sponsors.');
    current = () => findingsBody([], []);
    await move(wrapper, 2);
    expect(wrapper.find('[data-test=cut-in]').exists()).is.false;
  });

  it('stays quiet in games with several players and when watching is off', async () => {
    const many = {...soloView(), players: [{}, {}]} as unknown as ViewModel;
    const wrapper = await start(many);
    expect(wrapper.find('[data-test=watch-indicator]').exists()).is.false;
    expect(requests.some((r) => r.url.startsWith('api/coach/findings'))).is.false;
    coachSoloState.watch = false;
    const off = await start();
    expect(off.find('[data-test=watch-indicator]').exists()).is.false;
  });

  it('says when a decision was undone', async () => {
    const wrapper = await start();
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('api/coach/reflection')) {
        return new Response(JSON.stringify({schemaVersion: 'coach-reflection/1', findingId: 'g'.padEnd(16, '0'), status: 'gone', view: 'question'}), {status: 200});
      }
      return new Response(JSON.stringify(findingsBody([])), {status: 200});
    }) as typeof fetch;
    coachSoloState.reflectionId = 'g'.padEnd(16, '0');
    coachSoloState.tab = 'reflect';
    coachPanelState.open = true;
    await flushPromises();
    expect(wrapper.find('[data-test=reflect-gone]').exists()).is.true;
  });
});
