import {flushPromises, mount, VueWrapper} from '@vue/test-utils';
import {expect} from 'chai';
import {globalConfig} from '../../components/getLocalVue';
import CoachPanel from '@/extensions/coach/client/CoachPanel.vue';
import {coachPanelState} from '@/extensions/coach/client/coachPanelState';
import {coachSoloState} from '@/extensions/coach/client/coachSoloState';
import {extension} from '@/extensions/coach/extension.client';
import {factLines, limitationLabel} from '@/extensions/coach/client/choiceText';
import {blockerLine, forecastLines, linkLine, questionLine, signed} from '@/extensions/coach/common/coachText';
import {PlanForecast} from '@/extensions/coach/common/CoachAnalysis';
import {CoachChoiceListV1, CoachChoiceOption} from '@/extensions/coach/common/CoachChoiceList';
import {CoachCounselRequest, CoachCounselV1} from '@/extensions/coach/common/CoachCounsel';
import {ViewModel} from '@/common/models/PlayerModel';
import {CardName} from '@/common/cards/CardName';

const TOKEN = 'a'.repeat(32);

function option(id: string, extra: Partial<CoachChoiceOption> = {}): CoachChoiceOption {
  return {
    id: id.padEnd(16, '0'), group: 'now', kind: 'project-card', label: {template: '${0}', params: [{text: CardName.EARTH_OFFICE, card: true}]},
    cardNames: [CardName.EARTH_OFFICE], cost: 1, eligibility: 'legal-now', selectableForCoaching: true, limitations: [], ...extra,
  };
}

const CARD = option('1');
const OTHER = option('2', {label: {template: '${0}', params: [{text: CardName.CARTEL, card: true}]}, cardNames: [CardName.CARTEL], cost: 5});
const BUY = option('3', {kind: 'card-selection', label: {template: 'Select card(s) to buy', params: []}, cardNames: [CardName.MINE], cost: undefined, eligibility: 'not-action', selectableForCoaching: false, limitations: ['card-selection']});
const PLAN = option('4', {group: 'future', kind: 'strategy-plan', label: {template: '${0} → ${1}', params: []}, cardNames: [CardName.EARTH_OFFICE, CardName.CARTEL], planGoal: 'engine', eligibility: 'conditional', limitations: ['plan-not-one-move']});

function choiceList(extra: Partial<CoachChoiceListV1> = {}): CoachChoiceListV1 {
  return {schemaVersion: 'coach-choice-list/1', positionToken: TOKEN, analysisVersion: '2.0.0', stateStatus: 'awaiting-input', options: [CARD, OTHER, BUY, PLAN], omitted: [{reason: 'standard-project-not-available', count: 2}], ai: {available: true}, warnings: [], ...extra};
}

function counselBody(request: CoachCounselRequest, extra: Partial<CoachCounselV1> = {}): CoachCounselV1 {
  const review = request.mode === 'review';
  return {
    schemaVersion: 'coach-counsel/1', positionToken: request.positionToken, selectedChoiceId: request.choiceId, status: 'ready', source: review ? 'template' : 'none',
    facts: [
      {id: 'F1', about: 'game', kind: 'resources', value: {megacredits: 40, steel: 0, steelValue: 2, titanium: 0, titaniumValue: 3}, support: 'verified'},
      {id: 'F2', about: 'A', kind: 'cost', value: {card: CardName.EARTH_OFFICE, cost: 1}, support: 'verified'},
    ],
    strengths: review ? [{about: 'A', template: {template: 'The facts show no clear strength of this choice', params: []}, evidenceIds: ['F2'], support: 'verified'}] : [],
    risks: review ? [{about: 'A', text: '費用は 1 M€ です。', evidenceIds: ['F2'], support: 'conditional'}] : [],
    outlook: [],
    ...(review ? {question: {about: 'A', template: {template: 'What do you want to have done by the end of this generation, and how does this choice move you towards it?', params: []}, evidenceIds: ['F2'], support: 'verified'}} : {}),
    limitations: [], ai: {state: 'no-consent'}, ...extra,
  };
}

const playerView = {id: 'p123', thisPlayer: {}, game: {gameAge: 1, undoCount: 0, step: 2, phase: 'action'}} as unknown as ViewModel;

describe('CoachPanel (choice-driven)', () => {
  let requests: Array<{url: string, body?: CoachCounselRequest}>;
  let list: () => CoachChoiceListV1;
  let counsel: (r: CoachCounselRequest) => {status: number, body: unknown};
  const originalFetch = global.fetch;

  beforeEach(() => {
    requests = [];
    list = () => choiceList();
    counsel = (r) => ({status: 200, body: counselBody(r)});
    global.fetch = (async (input: unknown, init?: {body?: string}) => {
      const url = String(input);
      const body = init?.body === undefined ? undefined : JSON.parse(init.body) as CoachCounselRequest;
      requests.push({url, body});
      if (url.startsWith('api/coach/options')) {
        return new Response(JSON.stringify(list()), {status: 200});
      }
      const answer = counsel(body as CoachCounselRequest);
      return new Response(JSON.stringify(answer.body), {status: answer.status});
    }) as typeof fetch;
    coachPanelState.open = false;
    coachSoloState.tab = 'choices';
    coachSoloState.reflectionId = undefined;
    coachSoloState.findings = undefined;
    localStorage.removeItem('coach.aiConsent');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    coachPanelState.open = false;
  });

  async function open(view = playerView): Promise<VueWrapper> {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view}});
    await flushPromises();
    return wrapper;
  }

  function optionButton(wrapper: VueWrapper, text: string) {
    const button = wrapper.findAll('[data-test=option]').find((b) => b.text().includes(text));
    if (button === undefined) {
      throw new Error(`no option ${text}`);
    }
    return button;
  }

  it('shows nothing while closed and opens from the menu', () => {
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    expect(wrapper.find('.coach-panel').exists()).is.false;
    expect(requests).is.empty;
    expect(extension.menuItems?.[0].label).eq('Strategy coach');
    extension.menuItems?.[0].select();
    expect(coachPanelState.open).is.true;
  });

  it('lists Now and Future separately, with what cannot be reviewed yet', async () => {
    const wrapper = await open();
    expect(requests.map((r) => r.url)).deep.eq(['api/coach/options?id=p123']);
    const now = wrapper.find('[data-test=group-now]');
    const future = wrapper.find('[data-test=group-future]');
    expect(now.text()).contains('Now: what you can do');
    expect(now.text()).contains('Earth Office');
    expect(now.text()).contains('Cost: 1 M€');
    expect(now.text()).contains('A selection of cards, not one move');
    expect(future.text()).contains('Future: plans to look ahead');
    expect(future.text()).contains('Earth Office → Cartel');
    expect(future.text()).contains('Needs more than one move');
    expect(future.text()).contains('Later');
    expect(optionButton(wrapper, 'Select card(s) to buy').attributes('disabled')).is.not.undefined;
    expect(wrapper.text()).contains('2 standard projects cannot be done now');
    expect(wrapper.text()).contains('Choosing here does not play anything.');
  });

  it('shows the facts of a picked option without calling the model, then reviews it', async () => {
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    expect(requests[1].body).to.deep.include({mode: 'facts', choiceId: CARD.id, positionToken: TOKEN, aiConsent: false, compareWithChoiceId: null});
    expect(wrapper.text()).contains('Selected: Earth Office');
    // The facts are shown at once.
    expect(wrapper.find('[data-test=facts]').text()).contains('Earth Office: cost 1 M€');
    expect(wrapper.find('[data-test=facts]').text()).contains('You have 40 M€');

    await wrapper.find('[data-test=review]').trigger('click');
    await flushPromises();
    expect(requests[2].body?.mode).eq('review');
    expect(wrapper.find('[data-test=review-strengths]').text()).contains('The facts show no clear strength of this choice');
    expect(wrapper.find('[data-test=review-risks]').text()).contains('費用は 1 M€ です。');
    expect(wrapper.find('[data-test=review-risks]').text()).contains('Based on assumptions');
    expect(wrapper.find('[data-test=review-risks]').text()).contains('F2');
    expect(wrapper.find('[data-test=review-question]').exists()).is.true;
    expect(wrapper.text()).contains('Review from the game data (AI not used).');
    // After the review the facts fold away and can be opened again.
    expect(wrapper.find('[data-test=facts]').exists()).is.false;
    await wrapper.find('[data-test=evidence]').trigger('click');
    expect(wrapper.find('[data-test=facts]').exists()).is.true;
  });

  it('sends the consent only when the player ticks it', async () => {
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test=consent]').setValue(true);
    await wrapper.find('[data-test=review]').trigger('click');
    await flushPromises();
    expect(requests.at(-1)?.body?.aiConsent).is.true;
    expect(localStorage.getItem('coach.aiConsent')).eq('1');
  });

  it('hides the consent when the server has no model', async () => {
    list = () => choiceList({ai: {available: false}});
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test=consent]').exists()).is.false;
  });

  it('compares with another option picked from the list', async () => {
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test=compare]').trigger('click');
    expect(wrapper.find('[data-test=picking]').exists()).is.true;
    await optionButton(wrapper, 'Cartel').trigger('click');
    await flushPromises();
    expect(requests.at(-1)?.body).to.deep.include({choiceId: CARD.id, compareWithChoiceId: OTHER.id});
    expect(wrapper.text()).contains('Compared with: Cartel');
  });

  it('marks a review of an earlier position as stale after the game moves on', async () => {
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test=review]').trigger('click');
    await flushPromises();
    list = () => choiceList({positionToken: 'b'.repeat(32)});
    await wrapper.setProps({view: {...playerView, game: {...playerView.game, gameAge: 2}} as unknown as ViewModel});
    await flushPromises();
    expect(wrapper.find('[data-test=stale]').exists()).is.true;
    expect(wrapper.find('[data-test=review-strengths]').exists()).is.false;
  });

  it('keeps the latest options when an older answer arrives last', async () => {
    // The first request (old position) answers only after the second one (new position).
    let releaseOld: () => void = () => {};
    const oldAnswer = new Promise<void>((resolve) => releaseOld = resolve);
    let calls = 0;
    global.fetch = (async (input: unknown) => {
      requests.push({url: String(input)});
      calls++;
      if (calls === 1) {
        await oldAnswer;
        return new Response(JSON.stringify(choiceList({positionToken: 'd'.repeat(32), options: [CARD]})), {status: 200});
      }
      return new Response(JSON.stringify(choiceList({positionToken: 'e'.repeat(32), options: [OTHER]})), {status: 200});
    }) as typeof fetch;
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await wrapper.setProps({view: {...playerView, game: {...playerView.game, gameAge: 2}} as unknown as ViewModel});
    await flushPromises();
    releaseOld();
    await flushPromises();
    expect(calls).eq(2);
    expect(wrapper.find('[data-test=group-now]').text()).contains('Cartel');
    expect(wrapper.find('[data-test=group-now]').text()).does.not.contain('Earth Office');
    expect(wrapper.find('[data-test=error]').exists()).is.false;
  });

  it('reloads the options when the server says the position changed (409)', async () => {
    const wrapper = await open();
    counsel = () => ({status: 409, body: {status: 'stale'}});
    list = () => choiceList({positionToken: 'c'.repeat(32), options: [OTHER]});
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    expect(requests.filter((r) => r.url.startsWith('api/coach/options'))).has.length(2);
    expect(wrapper.find('[data-test=group-now]').exists()).is.true;
  });

  it('shows a model failure as a fallback and keeps the game data review', async () => {
    counsel = (r) => ({status: 200, body: counselBody(r, r.mode === 'review' ? {status: 'fallback', ai: {state: 'failed', category: 'timeout'}} : {})});
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test=review]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test=fallback]').exists()).is.true;
    expect(wrapper.find('[data-test=review-strengths]').exists()).is.true;
  });

  it('says why there is nothing to choose while others act', async () => {
    list = () => choiceList({stateStatus: 'waiting-for-others', options: [PLAN], omitted: []});
    const wrapper = await open();
    expect(wrapper.find('[data-test=status]').text()).eq('Other players are acting: nothing to choose right now.');
    expect(wrapper.find('[data-test=group-now]').exists()).is.false;
    expect(wrapper.find('[data-test=group-future]').exists()).is.true;
  });

  it('is only for players and reports a failing server', async () => {
    const spectator = await open({id: 's1', thisPlayer: undefined, game: playerView.game} as unknown as ViewModel);
    expect(spectator.text()).contains('The coach is only for players.');
    expect(requests).is.empty;
    list = () => {
      throw new Error('down');
    };
    global.fetch = (async () => new Response('x', {status: 500})) as typeof fetch;
    const failing = await open();
    expect(failing.find('[data-test=error]').exists()).is.true;
  });

  it('goes back to the list and closes', async () => {
    const wrapper = await open();
    await optionButton(wrapper, 'Earth Office').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test=choose-again]').trigger('click');
    expect(wrapper.find('[data-test=group-now]').exists()).is.true;
    await wrapper.find('[data-test=close]').trigger('click');
    expect(coachPanelState.open).is.false;
    expect(wrapper.find('.coach-panel').exists()).is.false;
  });
});

describe('choiceText', () => {
  it('writes facts from their values', () => {
    expect(factLines({id: 'F1', about: 'A', kind: 'cost', value: {card: 'Mine', cost: 4}, support: 'verified'})[0].template).eq('${0}: cost ${1} M€');
    expect(factLines({id: 'F1', about: 'game', kind: 'game', value: {generation: 3, lastGeneration: 14}, support: 'verified'})[0].params.map((p) => p.text)).deep.eq(['3', '14']);
    const forecast = factLines({id: 'F3', about: 'A', kind: 'forecast', value: {productionPhases: 3, productionChange: {megacredits: 2, steel: 0}, complete: false, megacredits: 'unknown', victoryPoints: 'unknown'}, support: 'conditional'}).map((l) => l.template);
    expect(forecast).includes('Production of ${0}: ${1}');
    expect(forecast).includes('Some effects are not modeled: totals are not shown');
    expect(factLines({id: 'F4', about: 'A', kind: 'plan', value: {cards: [{name: 'Mine'}, {name: 'Cartel'}]}, support: 'verified'}).map((l) => l.template)).deep.eq(['Plan: ${0}', 'then ${0}']);
    expect(limitationLabel('unknown-code')).eq('Not analysed');
  });
});

describe('coachText', () => {
  const zero = {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0};
  function forecast(overrides: Partial<PlanForecast> = {}): PlanForecast {
    return {
      horizonProductionPhases: 3, productionPhases: 1, productionsLeft: 'unknown',
      deltas: [{productionIndex: 0, resources: {...zero, megacredits: -6}, production: {...zero, megacredits: 2}, terraformRating: 0}],
      upfront: {play: 6, purchase: 0}, megacredits: {returned: 2, balance: -4, recovered: false},
      victoryPoints: {total: 1, terraformRating: 0, cards: 1}, complete: true, unmodeledEffects: [], assumptions: [], ...overrides,
    };
  }

  it('describes relations from their structured fields', () => {
    const base = {from: CardName.ARCTIC_ALGAE, to: CardName.ASTEROID, why: 'ignored', support: {level: 'verified' as const, evidence: []}};
    expect(linkLine({...base, kind: 'CONFLICTS_WITH', playFirst: CardName.ARCTIC_ALGAE}).template).eq('Play ${1} before ${0}');
    expect(linkLine({...base, kind: 'DISCOUNTS', alreadyApplied: true}).template).eq('${0} already lowers the cost of ${1}');
    expect(linkLine({...base, kind: 'UNLOCKS', completes: true}).template).eq('${0} meets the requirement of ${1}');
    expect(linkLine({...base, kind: 'SCORING', amount: 2}).params.map((p) => p.text)).deep.eq([CardName.ARCTIC_ALGAE, CardName.ASTEROID, '2']);
  });

  it('describes blockers', () => {
    const gap = {observed: 3, target: 8, comparator: '>=' as const, evidence: []};
    expect(blockerLine({...gap, kind: 'cost', gap: 5, status: 'unmet', card: CardName.CARTEL}).template).eq('${0}: ${1} M€ short');
    expect(blockerLine({...gap, kind: 'production', gap: 2, status: 'unmet', card: CardName.STRIP_MINE}).template).eq('${0}: not enough production');
    expect(blockerLine({...gap, kind: 'other', gap: 'unknown', status: 'unsupported', card: CardName.CARTEL}).template).eq('${0}: a condition cannot be checked');
  });

  it('never shows totals of incomplete forecasts', () => {
    const lines = forecastLines(forecast({complete: false, megacredits: 'unknown'})).map((l) => l.template);
    expect(lines).includes('Some effects are not modeled: totals are not shown');
    expect(lines).does.not.include('Paid back within this horizon');
  });

  it('formats signed numbers and questions', () => {
    expect([signed(3), signed(-2), signed(0)]).deep.eq(['+3', '−2', '0']);
    expect(questionLine({key: 'plan.unknown', params: {}, text: 'x'})).is.undefined;
  });
});
