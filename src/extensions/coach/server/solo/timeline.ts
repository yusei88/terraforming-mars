import {GameId} from '@/common/Types';
import {Color} from '@/common/Color';
import {InputResponse} from '@/common/inputs/InputResponse';
import {CoachChoice, CoachStateV1} from '../../common/CoachState';
import {CoachStateRef} from '../../common/CoachTrace';
import {COACH_TIMELINE_SCHEMA, CoachTimelineV1, ResourceSnapshot, SoloRules, TimelineEvent, TimelineKind} from '../../common/CoachTimeline';
import {CoachTracer, SeriesEvent} from '../coachTrace';

// DecisionEventNormalizer (P3-SOLO-1): the decisions of the history as meaningful events of a solo game.
//
// A decision of the history is "answer `response` to the question `offered`". Walking the response down
// the offered tree gives the input that was answered (play a project card, buy cards, pass…); the
// snapshots before and after confirm the meaning where they can. Only the history and its snapshots are
// read: nothing of the game is touched. Events keep their `seq` (unique in the history), so reading the
// same history twice gives the same events.

/** Most events used per request (a whole solo game has a few hundred). */
export const MAX_TIMELINE_EVENTS = 5000;

export function soloRules(state: CoachStateV1): SoloRules | undefined {
  if (state.game.mode !== 'solo') {
    return undefined;
  }
  return {victory: state.game.options.soloTR ? 'tr63' : 'terraform', lastGeneration: state.game.lastSoloGeneration};
}

function resources(state: CoachStateV1 | undefined): ResourceSnapshot | undefined {
  if (state === undefined) {
    return undefined;
  }
  const me = state.me;
  return {
    megacredits: me.resources.megacredits, steel: me.resources.steel, titanium: me.resources.titanium,
    plants: me.resources.plants, energy: me.resources.energy, heat: me.resources.heat,
    production: me.production, terraformRating: me.terraformRating, cardsInHand: me.hand.length,
  };
}

/** The answered input: the offered node the response ends at, with the response to it. */
type Answered = {choice: CoachChoice, response: InputResponse};

/** Follows `or` branches down to the input that was actually answered. */
function answered(offered: CoachChoice | undefined, response: InputResponse): Answered | undefined {
  if (offered === undefined) {
    return undefined;
  }
  if (response.type === 'or' && offered.inputType === 'or') {
    const next = offered.options?.[response.index];
    return next === undefined ? undefined : answered(next, response.response);
  }
  return {choice: offered, response};
}

type Normalized = Pick<TimelineEvent, 'kind' | 'cards'> & Partial<Pick<TimelineEvent, 'offeredCards' | 'chosen' | 'cost' | 'payment' | 'label'>>;

function paymentOf(payment: object): Record<string, number> {
  return Object.fromEntries(Object.entries(payment).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<string, number>;
}

/** What one accepted answer means. */
export function normalizeDecision(offered: CoachChoice | undefined, response: InputResponse): Normalized {
  const leaf = answered(offered, response);
  if (leaf === undefined) {
    return {kind: 'other', cards: []};
  }
  const {choice, response: r} = leaf;
  switch (choice.inputType) {
  case 'projectCard':
    if (r.type !== 'projectCard') {
      return {kind: 'other', cards: [], label: choice.title};
    }
    if (choice.title === 'Standard projects') {
      return {kind: 'standard-project', cards: [r.card], cost: choice.cards?.find((c) => c.name === r.card)?.calculatedCost, payment: paymentOf(r.payment)};
    }
    return {kind: 'play-card', cards: [r.card], cost: choice.cards?.find((c) => c.name === r.card)?.calculatedCost, payment: paymentOf(r.payment)};
  case 'card': {
    const cards = r.type === 'card' ? r.cards : [];
    if (choice.selectBlueCardAction === true) {
      return {kind: 'card-action', cards};
    }
    if (/buy/i.test(choice.title)) {
      return {kind: 'buy-cards', cards, offeredCards: (choice.cards ?? []).map((c) => c.name)};
    }
    if (choice.title === 'Sell patents') {
      return {kind: 'sell-patents', cards};
    }
    return {kind: 'follow-up', cards, label: choice.title};
  }
  case 'initialCards': {
    if (r.type !== 'initialCards') {
      return {kind: 'other', cards: []};
    }
    const bought: Array<string> = [];
    const chosen: Array<string> = [];
    (choice.options ?? []).forEach((option, i) => {
      const part = r.responses[i];
      if (part?.type !== 'card') {
        return;
      }
      (/buy/i.test(option.title) ? bought : chosen).push(...part.cards);
    });
    return {kind: 'initial-selection', cards: bought, chosen};
  }
  case 'option':
    if (choice.title === 'Pass for this generation') {
      return {kind: 'pass', cards: []};
    }
    if (choice.title === 'End Turn') {
      return {kind: 'end-turn', cards: []};
    }
    return {kind: 'game-option', cards: [], label: choice.title};
  case 'and':
    return {kind: 'other', cards: [], label: choice.title};
  default:
    return {kind: 'follow-up', cards: [], label: choice.title};
  }
}

function countOf(names: ReadonlyArray<{name: string}>, name: string): number {
  return names.filter((c) => c.name === name).length;
}

/** Whether the snapshots before and after confirm what the event says. */
function confirmed(event: Normalized, before: CoachStateV1 | undefined, after: CoachStateV1 | undefined): boolean {
  if (before === undefined || after === undefined) {
    return false;
  }
  switch (event.kind) {
  case 'play-card': {
    const card = event.cards[0];
    return countOf(before.me.hand, card) > countOf(after.me.hand, card) && after.me.tableau.some((c) => c.name === card);
  }
  case 'buy-cards':
  case 'initial-selection':
    return event.cards.every((card) => countOf(after.me.hand, card) > countOf(before.me.hand, card));
  case 'sell-patents':
    return event.cards.every((card) => countOf(after.me.hand, card) < countOf(before.me.hand, card));
  default:
    return true;
  }
}

function lookup(states: ReadonlyMap<string, CoachStateV1>, ref: CoachStateRef | undefined): CoachStateV1 | undefined {
  if (ref === undefined) {
    return undefined;
  }
  return states.get(`${ref.fingerprint}:${ref.advisoryFingerprint ?? ''}`) ?? states.get(`${ref.fingerprint}:`);
}

/** Timeline events of one player from the history (events of other players are not passed in). */
export function timelineEvents(events: ReadonlyArray<SeriesEvent>, states: ReadonlyMap<string, CoachStateV1>): Array<TimelineEvent & {beforeState?: CoachStateV1}> {
  const out: Array<TimelineEvent & {beforeState?: CoachStateV1}> = [];
  const seen = new Set<number>();
  for (const event of events) {
    // The same seq read twice (a duplicated line) is one event.
    if (seen.has(event.seq)) {
      continue;
    }
    seen.add(event.seq);
    if (event.type === 'decision') {
      const before = lookup(states, event.before);
      const after = lookup(states, event.after);
      const normalized = normalizeDecision(event.offered, event.response);
      out.push({
        id: `s${event.seq}`, seq: event.seq, generation: event.before.version.generation, phase: event.before.version.phase,
        branch: event.before.branch, series: event.series, ...normalized,
        before: resources(before), after: resources(after), verified: confirmed(normalized, before, after), beforeState: before,
      });
    } else if (event.type === 'revert') {
      const kind: TimelineKind = event.kind === 'undo' ? 'undo' : 'cancel-action';
      out.push({
        id: `s${event.seq}`, seq: event.seq, kind, cards: [], generation: event.from.version.generation, phase: event.from.version.phase,
        branch: event.from.branch, series: event.series, verified: event.to !== undefined,
      });
    }
  }
  // Order of the actions in each generation, along the current line of play.
  const orders = new Map<number, number>();
  for (const e of out) {
    if (e.series === 'current' && e.kind !== 'follow-up' && e.kind !== 'undo' && e.kind !== 'cancel-action') {
      const next = (orders.get(e.generation) ?? 0) + 1;
      orders.set(e.generation, next);
      e.order = next;
    }
  }
  return out;
}

export type TimelineSource = {
  tracer: CoachTracer | undefined,
  gameId: GameId,
  color: Color,
  /** The player's position now. */
  state: CoachStateV1,
  history: () => CoachTimelineV1['history'],
};

/** Events with their snapshots, for the timeline and the evaluators; or why there are none. */
export function loadTimeline(source: TimelineSource): {status: CoachTimelineV1['status'], events: Array<TimelineEvent & {beforeState?: CoachStateV1}>, truncated: boolean} {
  if (soloRules(source.state) === undefined) {
    return {status: 'not-solo', events: [], truncated: false};
  }
  if (source.tracer === undefined) {
    return {status: 'disabled', events: [], truncated: false};
  }
  const read = source.tracer.eventsOf(source.gameId, source.color);
  const states = source.tracer.statesOf(source.gameId, source.color);
  if (read.error !== undefined || states.error !== undefined) {
    return {status: 'unreadable', events: [], truncated: false};
  }
  const truncated = read.events.length > MAX_TIMELINE_EVENTS;
  return {status: 'ok', events: timelineEvents(read.events.slice(0, MAX_TIMELINE_EVENTS), states.states), truncated};
}

/** The timeline of the player (GET api/coach/timeline). */
export function buildTimeline(source: TimelineSource): CoachTimelineV1 {
  const loaded = loadTimeline(source);
  const state = source.state;
  const vp = state.me.victoryPoints.status === 'known' ? state.me.victoryPoints.value.total : undefined;
  const now = {generation: state.game.generation, phase: state.game.phase, terraformRating: state.me.terraformRating, ...(vp === undefined ? {} : {victoryPoints: vp})};
  const solo = soloRules(state);
  const strip = ({beforeState: _, ...e}: TimelineEvent & {beforeState?: CoachStateV1}): TimelineEvent => e;
  const kept = loaded.events.filter((e) => e.series !== 'superseded' && e.kind !== 'follow-up').map(strip);
  const generations = new Map<number, Array<TimelineEvent>>();
  for (const e of kept) {
    generations.set(e.generation, [...(generations.get(e.generation) ?? []), e]);
  }
  return {
    schemaVersion: COACH_TIMELINE_SCHEMA,
    status: loaded.status,
    history: loaded.status === 'ok' ? source.history() : loaded.status === 'disabled' ? 'disabled' : 'uncertain',
    ...(solo === undefined ? {} : {solo}),
    generations: [...generations.entries()].sort(([a], [b]) => a - b).map(([generation, events]) => ({generation, events})),
    superseded: loaded.events.filter((e) => e.series === 'superseded' && e.kind !== 'follow-up').map(strip),
    now,
    truncated: loaded.truncated,
  };
}
