import {flushPromises, mount} from '@vue/test-utils';
import {expect} from 'chai';
import {globalConfig} from '../../components/getLocalVue';
import CoachPanel from '@/extensions/coach/client/CoachPanel.vue';
import {coachPanelState} from '@/extensions/coach/client/coachPanelState';
import {extension} from '@/extensions/coach/extension.client';
import {blockerLine, forecastLines, linkLine, questionLine, signed} from '@/extensions/coach/client/coachText';
import {CandidatePlan, CoachAnalysisV1, PlanForecast} from '@/extensions/coach/common/CoachAnalysis';
import {ViewModel} from '@/common/models/PlayerModel';
import {CardName} from '@/common/cards/CardName';

const zero = {megacredits: 0, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0};

function forecast(overrides: Partial<PlanForecast> = {}): PlanForecast {
  return {
    horizonProductionPhases: 3, productionPhases: 1, productionsLeft: 'unknown',
    deltas: [
      {productionIndex: 0, resources: {...zero, megacredits: -6}, production: {...zero, megacredits: 2}, terraformRating: 0},
      {productionIndex: 1, resources: {...zero, megacredits: -4}, production: {...zero, megacredits: 2}, terraformRating: 0},
    ],
    upfront: {play: 6, purchase: 0},
    megacredits: {returned: 2, balance: -4, recovered: false},
    victoryPoints: {total: 1, terraformRating: 0, cards: 1},
    complete: true, unmodeledEffects: [], assumptions: [],
    ...overrides,
  };
}

function plan(): CandidatePlan {
  return {
    id: 'Earth Office > Cartel',
    goal: 'engine',
    goals: ['engine'],
    cards: [
      {name: CardName.EARTH_OFFICE, zone: 'hand', availability: 'legal-now', reasons: [], cost: 1},
      {name: CardName.CARTEL, zone: 'hand', availability: 'conditional', reasons: [], cost: 5},
    ],
    links: [{from: CardName.EARTH_OFFICE, to: CardName.CARTEL, kind: 'DISCOUNTS', amount: 3, why: '', support: {level: 'verified', evidence: []}}],
    blockers: [],
    payments: {play: 6, purchase: 0},
    support: {level: 'verified', evidence: []},
    question: {key: 'plan.engine', params: {from: CardName.EARTH_OFFICE, to: CardName.CARTEL}, text: ''},
    forecast: forecast(),
  };
}

function analysis(): CoachAnalysisV1 {
  return {
    schemaVersion: 'coach-analysis/1',
    source: {fingerprint: 'f', advisoryFingerprint: 'a', catalogVersion: 'c', analysisVersion: '2.0.0', generatedAt: ''},
    horizonProductionPhases: 3,
    coverage: {supported: 2, partial: 1, unsupported: 0, reasons: []},
    candidates: [plan()],
    discarded: [],
    limitations: [],
    warnings: [],
    search: {poolSize: 2, chainsExamined: 3, truncated: false, elapsedMs: 1},
  };
}

const playerView = {id: 'p123', thisPlayer: {}, game: {gameAge: 1, undoCount: 0, step: 2, phase: 'action'}} as unknown as ViewModel;

describe('CoachPanel', () => {
  let requests: Array<string>;
  let answer: () => Promise<Response>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    requests = [];
    answer = async () => new Response(JSON.stringify(analysis()), {status: 200});
    global.fetch = (async (input: unknown) => {
      requests.push(String(input));
      return answer();
    }) as typeof fetch;
    coachPanelState.open = false;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    coachPanelState.open = false;
  });

  it('shows nothing while closed', () => {
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    expect(wrapper.find('.coach-panel').exists()).is.false;
    expect(requests).is.empty;
  });

  it('opens from the menu entry', () => {
    expect(extension.menuItems?.[0].label).eq('Strategy coach');
    extension.menuItems?.[0].select();
    expect(coachPanelState.open).is.true;
  });

  it('shows the plans of the player', async () => {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await flushPromises();
    expect(requests).deep.eq(['api/coach/analysis?id=p123&horizon=3']);
    const text = wrapper.text();
    expect(wrapper.findAll('[data-test=plan]')).has.length(1);
    expect(text).contains('Engine');
    expect(text).contains('Earth Office');
    expect(text).contains('Playable now');
    expect(text).contains('Later');
    expect(text).contains('Earth Office makes Cartel cheaper by 3 M€');
    expect(text).contains('After production 1');
    expect(text).contains('Not paid back within this horizon');
    expect(text).contains('VP now: 1');
    expect(text).contains('2 of 3 cards fully modeled');
    expect(wrapper.find('[data-test=question]').text()).eq('Earth Office helps you pay for Cartel. How many more cards will profit from it before the game ends?');
  });

  it('asks again with another horizon', async () => {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await flushPromises();
    await wrapper.find('[data-test=horizon]').setValue(1);
    await flushPromises();
    expect(requests.at(-1)).eq('api/coach/analysis?id=p123&horizon=1');
  });

  it('refreshes when the game moves on', async () => {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await flushPromises();
    await wrapper.setProps({view: {...playerView, game: {...playerView.game, gameAge: 2}} as unknown as ViewModel});
    await flushPromises();
    expect(requests).has.length(2);
  });

  it('is only for players', async () => {
    coachPanelState.open = true;
    const spectator = {id: 's1', thisPlayer: undefined, game: playerView.game} as unknown as ViewModel;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: spectator}});
    await flushPromises();
    expect(wrapper.text()).contains('The coach is only for players.');
    // Only a player id is ever sent, whatever the view holds.
    const notAPlayer = {...playerView, id: 's1'} as unknown as ViewModel;
    const other = mount(CoachPanel, {...globalConfig, props: {view: notAPlayer}});
    await flushPromises();
    expect(other.text()).contains('The coach is only for players.');
    expect(requests).is.empty;
  });

  it('reports a failing analysis without breaking the page', async () => {
    answer = async () => new Response('coach analysis unavailable', {status: 500});
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await flushPromises();
    expect(wrapper.find('[data-test=error]').text()).eq('The coach is not available right now.');
  });

  it('closes', async () => {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: playerView}});
    await flushPromises();
    await wrapper.find('[data-test=close]').trigger('click');
    expect(coachPanelState.open).is.false;
    expect(wrapper.find('.coach-panel').exists()).is.false;
  });
});

describe('coachText', () => {
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
