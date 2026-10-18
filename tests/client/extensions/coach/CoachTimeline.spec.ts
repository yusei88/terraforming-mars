import {flushPromises, mount, VueWrapper} from '@vue/test-utils';
import {expect} from 'chai';
import {globalConfig} from '../../components/getLocalVue';
import CoachPanel from '@/extensions/coach/client/CoachPanel.vue';
import {coachPanelState} from '@/extensions/coach/client/coachPanelState';
import {coachSoloState} from '@/extensions/coach/client/coachSoloState';
import {eventLines} from '@/extensions/coach/client/timelineText';
import {CoachTimelineV1, TimelineEvent} from '@/extensions/coach/common/CoachTimeline';
import {ViewModel} from '@/common/models/PlayerModel';
import {CardName} from '@/common/cards/CardName';

function event(seq: number, extra: Partial<TimelineEvent>): TimelineEvent {
  return {id: `s${seq}`, seq, kind: 'pass', generation: 1, phase: 'action', branch: 0, series: 'current', cards: [], verified: true, ...extra};
}

function timeline(extra: Partial<CoachTimelineV1> = {}): CoachTimelineV1 {
  return {
    schemaVersion: 'coach-timeline/1', status: 'ok', history: 'valid', solo: {victory: 'terraform', lastGeneration: 14},
    generations: [
      {generation: 1, events: [event(1, {kind: 'initial-selection', cards: [CardName.MINE, CardName.ALGAE], chosen: [CardName.TERACTOR], order: 1})]},
      {generation: 2, events: [
        event(3, {kind: 'buy-cards', generation: 2, cards: [CardName.SPONSORS, CardName.EARTH_OFFICE, CardName.CARTEL], order: 1}),
        event(4, {kind: 'play-card', generation: 2, cards: [CardName.SPONSORS], cost: 6, order: 2}),
        event(5, {kind: 'play-card', generation: 2, cards: [CardName.EARTH_OFFICE], cost: 1, order: 3, verified: false}),
      ]},
    ],
    superseded: [event(2, {kind: 'play-card', generation: 2, cards: [CardName.CARTEL], cost: 8})],
    now: {generation: 2, phase: 'action', terraformRating: 20, victoryPoints: 21},
    truncated: false,
    ...extra,
  };
}

const soloView = {id: 'p123', thisPlayer: {}, players: [{}], game: {gameAge: 1, undoCount: 0, step: 2, phase: 'action'}} as unknown as ViewModel;

describe('CoachPanel timeline (P3-SOLO-1)', () => {
  let answer: () => CoachTimelineV1;
  let urls: Array<string>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    urls = [];
    answer = () => timeline();
    global.fetch = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('api/coach/timeline')) {
        return new Response(JSON.stringify(answer()), {status: 200});
      }
      return new Response(JSON.stringify({schemaVersion: 'coach-choice-list/1', positionToken: 'a'.repeat(32), analysisVersion: '2', stateStatus: 'awaiting-input', options: [], omitted: [], ai: {available: false}, warnings: []}), {status: 200});
    }) as typeof fetch;
    coachPanelState.open = false;
    coachSoloState.tab = 'choices';
    coachSoloState.reflectionId = undefined;
    coachSoloState.findings = undefined;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    coachPanelState.open = false;
  });

  async function openTimeline(view = soloView): Promise<VueWrapper> {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view}});
    await flushPromises();
    await wrapper.find('[data-test=tab-timeline]').trigger('click');
    await flushPromises();
    return wrapper;
  }

  it('shows purchases, plays in their order and the newest generation first', async () => {
    const wrapper = await openTimeline();
    expect(urls).includes('api/coach/timeline?id=p123');
    const generations = wrapper.findAll('[data-test=timeline-generation]');
    expect(generations.map((g) => g.find('h3').text())).deep.eq(['Generation 2', 'Generation 1']);
    const events = generations[0].findAll('[data-test=timeline-event]').map((e) => e.text());
    expect(events[0]).contains('Bought 3 cards');
    expect(events[0]).contains('Sponsors, Earth Office, Cartel');
    expect(events[1]).contains('2');
    expect(events[1]).contains('Played Sponsors for 6 M€');
    expect(events[2]).contains('Played Earth Office for 1 M€');
    expect(events[2]).contains('Not confirmed by the game state');
    expect(generations[1].text()).contains('Chose Teractor');
    expect(wrapper.find('[data-test=timeline-now]').text()).contains('Now: generation 2, TR 20');
    expect(wrapper.text()).contains('Victory: terraform Mars by generation 14');
  });

  it('keeps undone actions folded and apart', async () => {
    const wrapper = await openTimeline();
    expect(wrapper.text()).does.not.contain('Played Cartel');
    await wrapper.find('[data-test=timeline-undone]').trigger('click');
    expect(wrapper.text()).contains('Played Cartel for 8 M€');
  });

  it('says why there is no timeline instead of showing an empty one', async () => {
    answer = () => timeline({status: 'disabled', history: 'disabled', generations: [], superseded: []});
    const wrapper = await openTimeline();
    expect(wrapper.find('[data-test=timeline-status]').text()).eq('History is off on this server (COACH_TRACE_DIR is not set).');
    expect(wrapper.findAll('[data-test=timeline-generation]')).is.empty;
  });

  it('warns when the history may be incomplete', async () => {
    answer = () => timeline({history: 'uncertain'});
    const wrapper = await openTimeline();
    expect(wrapper.text()).contains('The history may be incomplete');
  });

  it('has no timeline tab in a game with several players', async () => {
    coachPanelState.open = true;
    const wrapper = mount(CoachPanel, {...globalConfig, props: {view: {...soloView, players: [{}, {}]} as unknown as ViewModel}});
    await flushPromises();
    expect(wrapper.find('[data-test=tab-timeline]').exists()).is.false;
    expect(urls.some((u) => u.startsWith('api/coach/timeline'))).is.false;
  });

  it('writes each kind of event', () => {
    expect(eventLines(event(1, {kind: 'buy-cards', cards: []}))[0].template).eq('Bought no cards');
    expect(eventLines(event(1, {kind: 'standard-project', cards: [CardName.POWER_PLANT_STANDARD_PROJECT]}))[0].template).eq('Standard project: ${0}');
    expect(eventLines(event(1, {kind: 'sell-patents', cards: ['a', 'b']}))[0].params[0].text).eq('2');
    expect(eventLines(event(1, {kind: 'game-option', label: 'Convert 8 heat into temperature'}))[0].params[0]).deep.eq({text: 'Convert 8 heat into temperature', card: true});
    expect(eventLines(event(1, {kind: 'undo'}))[0].template).eq('Undo');
  });
});
