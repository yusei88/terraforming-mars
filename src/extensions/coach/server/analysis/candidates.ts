import {CoachCardInstance, CoachChoice, CoachStateV1} from '../../common/CoachState';
import {
  CandidatePlan, CandidateSet, CardZone, PlanCard, PlanGoal, PlanQuestion, RequirementGap, Support, SynergyEdge, SynergyGraph,
} from '../../common/CoachAnalysis';
import {EffectAtom} from '../../common/CoachMechanics';
import {CardName} from '@/common/cards/CardName';
import {CardType} from '@/common/cards/CardType';
import {catalogCard} from '../cardCatalog';
import {mechanicsOf} from './mechanicsCatalog';
import {analyzeRequirements} from './requirements';
import {discountOn} from './discounts';
import {affordability} from './payments';
import {buildSynergyGraph} from './synergyGraph';

// Candidate plans (Gate C): short lines of play of 1–3 unplayed cards linked by graph edges, each with what
// is legal now, what blocks the rest, what it costs, and a question for the player. Plans of different
// goals are kept side by side; there is no single "best plan" score. Bounded by fixed limits.

export type CandidateLimits = {
  /** Unplayed cards considered (hand first, then offer). */
  maxPool: number,
  /** Chains examined before stopping. */
  maxChains: number,
  /** Time budget for the search in ms. */
  maxMillis: number,
  /** Plans returned (spread over goals). */
  maxCandidates: number,
};

export const DEFAULT_LIMITS: CandidateLimits = {maxPool: 40, maxChains: 5000, maxMillis: 150, maxCandidates: 9};

const PROJECT_TYPES: ReadonlySet<string> = new Set([CardType.AUTOMATED, CardType.ACTIVE, CardType.EVENT]);
// Edges that make an earlier card help a later one (CONFLICTS_WITH restricts order instead).
const HELPFUL: ReadonlySet<string> = new Set(['UNLOCKS', 'DISCOUNTS', 'PRODUCES_FOR', 'SCORING']);

type PoolCard = {name: CardName, zone: CardZone, instance: CoachCardInstance, path: string, gaps: ReadonlyArray<RequirementGap>};

function legalNow(state: CoachStateV1): Set<CardName> {
  const result = new Set<CardName>();
  const walk = (choice: CoachChoice) => {
    if (choice.inputType === 'projectCard') {
      (choice.cards ?? []).forEach((card) => result.add(card.name));
    }
    (choice.options ?? []).forEach(walk);
  };
  if (state.choices.status === 'awaiting-input') {
    walk(state.choices.root);
  }
  return result;
}

function pool(state: CoachStateV1, graph: SynergyGraph, limits: CandidateLimits, discarded: Array<{cardName: CardName, reason: string}>): {cards: Array<PoolCard>, truncated: boolean} {
  const instances = new Map<CardName, {instance: CoachCardInstance, path: string}>();
  state.me.hand.forEach((card, i) => instances.set(card.name, {instance: card, path: `me.hand[${i}]`}));
  state.me.draftedCards.forEach((card, i) => instances.has(card.name) || instances.set(card.name, {instance: card, path: `me.draftedCards[${i}]`}));
  const offered: Array<{card: CoachCardInstance, path: string}> = [];
  const walk = (choice: CoachChoice) => {
    if (choice.inputType === 'card') {
      (choice.cards ?? []).forEach((card, i) => offered.push({card, path: `choices.root${choice.path === '' ? '' : '.' + choice.path}.cards[${i}]`}));
    }
    (choice.options ?? []).forEach(walk);
  };
  if (state.choices.status === 'awaiting-input') {
    walk(state.choices.root);
  }
  offered.forEach(({card, path}) => instances.has(card.name) || instances.set(card.name, {instance: card, path}));

  const cards: Array<PoolCard> = [];
  for (const node of graph.nodes) {
    if (node.zone === 'played') {
      continue;
    }
    const catalog = catalogCard(node.name);
    const mechanics = mechanicsOf(node.name);
    const found = instances.get(node.name);
    if (catalog === undefined || mechanics === undefined || found === undefined) {
      discarded.push({cardName: node.name, reason: 'not in the card catalog of this build'});
      continue;
    }
    if (!PROJECT_TYPES.has(catalog.type)) {
      discarded.push({cardName: node.name, reason: `${catalog.type} cards are chosen, not planned`});
      continue;
    }
    const gaps = analyzeRequirements(state, mechanics);
    if (gaps.some((gap) => gap.permanentlyUnmet === true)) {
      discarded.push({cardName: node.name, reason: 'a maximum requirement is already exceeded; it can never be played'});
      continue;
    }
    cards.push({name: node.name, zone: node.zone, instance: found.instance, path: found.path, gaps});
  }
  // Hand before offer, then by name: the pool limit keeps what the player already has.
  cards.sort((a, b) => (a.zone === b.zone ? a.name.localeCompare(b.name) : a.zone === 'hand' ? -1 : 1));
  const truncated = cards.length > limits.maxPool;
  for (const dropped of cards.slice(limits.maxPool)) {
    discarded.push({cardName: dropped.name, reason: `over the search limit of ${limits.maxPool} cards`});
  }
  return {cards: cards.slice(0, limits.maxPool), truncated};
}

function atomsOf(name: CardName): ReadonlyArray<EffectAtom> {
  return mechanicsOf(name)?.atoms ?? [];
}

function goalsOf(chain: ReadonlyArray<PoolCard>, links: ReadonlyArray<SynergyEdge>): Array<PlanGoal> {
  const goals: Array<PlanGoal> = [];
  const add = (goal: PlanGoal) => goals.includes(goal) || goals.push(goal);
  // Relations first: they say why these cards belong together.
  if (links.some((l) => l.kind === 'UNLOCKS')) {
    add('unlock');
  }
  if (links.some((l) => l.kind === 'DISCOUNTS' || l.kind === 'PRODUCES_FOR')) {
    add('engine');
  }
  if (links.some((l) => l.kind === 'SCORING')) {
    add('scoring');
  }
  const atoms = chain.flatMap((card) => atomsOf(card.name));
  if (atoms.some((a) => a.kind === 'production' && a.amount > 0)) {
    add('economy');
  }
  if (atoms.some((a) => a.kind === 'global' || a.kind === 'tr')) {
    add('terraforming');
  }
  if (atoms.some((a) => a.kind === 'victoryPoints' || a.kind === 'victoryPointsPerResource' || a.kind === 'victoryPointsPerTag')) {
    add('scoring');
  }
  if (atoms.some((a) => a.source === 'action')) {
    add('engine');
  }
  return goals.length > 0 ? goals : ['economy'];
}

function question(goal: PlanGoal, chain: ReadonlyArray<PoolCard>, links: ReadonlyArray<SynergyEdge>): PlanQuestion {
  const first = chain[0].name;
  const last = chain[chain.length - 1].name;
  const link = links.find((l) => l.to === last) ?? links[0];
  const from = link?.from ?? first;
  switch (goal) {
  case 'unlock':
    return {key: 'plan.unlock', params: {from, to: last}, text: `Is it worth playing ${from} mainly to meet the requirement of ${last}, or is there another way to get there?`};
  case 'engine':
    return {key: 'plan.engine', params: {from, to: last}, text: `${from} helps you pay for ${last}. How many more cards will profit from it before the game ends?`};
  case 'scoring':
    return {key: 'plan.scoring', params: {from, to: last}, text: `How many points will ${last} be worth at the end, and what does it take to keep adding to them?`};
  case 'terraforming':
    return {key: 'plan.terraforming', params: {card: first}, text: `Raising a global parameter with ${first} also moves other requirements. Which of your cards does it help or block?`};
  case 'economy':
    return {key: 'plan.economy', params: {card: first}, text: `How many production phases are left for ${first} to pay back what it costs?`};
  }
}

/* Evaluates one chain: availability, blockers left after earlier cards, costs, support. */
function evaluate(state: CoachStateV1, chain: ReadonlyArray<PoolCard>, graph: SynergyGraph, legal: Set<CardName>, playedLinks: Map<CardName, Array<SynergyEdge>>): CandidatePlan {
  const names = chain.map((card) => card.name);
  const inner = graph.edges.filter((e) => HELPFUL.has(e.kind) && names.includes(e.from) && names.includes(e.to) && names.indexOf(e.from) < names.indexOf(e.to));
  const links = [...names.flatMap((name) => playedLinks.get(name) ?? []), ...inner];
  const blockers: Array<RequirementGap & {card: CardName}> = [];
  const cards: Array<PlanCard> = [];
  const assumptions: Array<string> = [];
  let play: number | 'unknown' = 0;
  let purchase = 0;
  chain.forEach((card, index) => {
    const reasons: Array<string> = [];
    const earlier = names.slice(0, index);
    // Requirement gaps closed by earlier cards of the plan.
    const closed = new Map<number, number>();
    for (const edge of inner) {
      if (edge.kind === 'UNLOCKS' && edge.to === card.name && earlier.includes(edge.from) && edge.requirementIndex !== undefined) {
        closed.set(edge.requirementIndex, (closed.get(edge.requirementIndex) ?? 0) + (edge.amount ?? 0));
      }
    }
    let unknown = false;
    card.gaps.forEach((gap, i) => {
      if (gap.status === 'unsupported') {
        unknown = true;
        reasons.push(`requirement not evaluated: ${gap.assumptions?.join('; ') ?? 'unknown'}`);
        blockers.push({...gap, card: card.name});
        return;
      }
      const remaining = typeof gap.gap === 'number' ? gap.gap - (closed.get(i) ?? 0) : gap.gap;
      if (gap.comparator === '>=' && typeof remaining === 'number' && remaining <= 0 && (closed.get(i) ?? 0) > 0) {
        reasons.push(`requirement met by ${earlier.join(', ')}`);
        return;
      }
      if (gap.status === 'unmet' || gap.status === 'conditional') {
        if (gap.status === 'unmet' || (typeof gap.gap === 'number' && gap.gap > 0)) {
          blockers.push({...gap, gap: remaining, card: card.name});
        }
        if (gap.status === 'conditional') {
          assumptions.push(...(gap.assumptions ?? []));
        }
      }
    });
    // Cost after the discounts of earlier cards of the plan (never below 0).
    let cost: number | 'unknown' = card.instance.calculatedCost ?? 'unknown';
    if (typeof cost === 'number') {
      for (const from of earlier) {
        const discount = discountOn(from, card.name);
        if (discount === undefined) {
          cost = 'unknown';
          break;
        }
        cost = Math.max(0, cost - discount.amount);
      }
    }
    play = play === 'unknown' || cost === 'unknown' ? 'unknown' : play + cost;
    if (index === 0) {
      const afford = affordability(state, card.name, cost, `${card.path}.calculatedCost`);
      if (afford.status !== 'met') {
        blockers.push({...afford, card: card.name});
        if (afford.status === 'conditional') {
          assumptions.push(...(afford.assumptions ?? []));
        }
      }
    }
    let availability: PlanCard['availability'];
    if (card.zone === 'offered') {
      purchase += state.me.cardCost;
      availability = unknown ? 'unknown' : 'conditional';
      reasons.push(`must be bought first (${state.me.cardCost} M€)`);
    } else if (index === 0 && legal.has(card.name)) {
      availability = 'legal-now';
    } else {
      availability = unknown ? 'unknown' : 'conditional';
      if (index > 0) {
        reasons.push(`after ${earlier.join(', ')}`);
      } else if (state.choices.status === 'awaiting-input' && legal.size > 0) {
        reasons.push('the game does not offer it to play right now');
      } else {
        reasons.push('cards can be played only on your turn in the action phase');
      }
    }
    const planCard: PlanCard = {name: card.name, zone: card.zone, availability, reasons, cost};
    if (card.zone === 'offered') {
      planCard.purchaseCost = state.me.cardCost;
    }
    cards.push(planCard);
  });
  for (const link of links) {
    if (link.support.level === 'conditional') {
      assumptions.push(...link.support.assumptions);
    }
  }
  const goals = goalsOf(chain, links);
  const evidence = links.flatMap((l) => (l.support.level === 'unsupported' ? [] : l.support.evidence));
  const unique = [...new Set(assumptions)];
  const support: Support = unique.length > 0 ? {level: 'conditional', assumptions: unique, evidence} : {level: 'verified', evidence};
  return {
    id: names.join(' > '),
    goal: goals[0],
    goals,
    cards,
    links,
    blockers,
    payments: {play, purchase},
    support,
    question: question(goals[0], chain, links),
  };
}

/* Order inside one goal (documented, not a value judgment): playable now first, fewer blockers, more
   links, fewer cards, then name. */
function compare(a: CandidatePlan, b: CandidatePlan): number {
  const now = (p: CandidatePlan) => (p.cards[0].availability === 'legal-now' ? 0 : 1);
  return now(a) - now(b) ||
    a.blockers.length - b.blockers.length ||
    b.links.length - a.links.length ||
    a.cards.length - b.cards.length ||
    a.id.localeCompare(b.id);
}

/** Enumerates candidate plans for the player of `state`, within `limits`. Pure and deterministic. */
export function buildCandidates(state: CoachStateV1, limits: CandidateLimits = DEFAULT_LIMITS, graph: SynergyGraph = buildSynergyGraph(state)): CandidateSet {
  const started = Date.now();
  const discarded: Array<{cardName: CardName, reason: string}> = [];
  const warnings: Array<string> = [];
  const {cards, truncated: poolTruncated} = pool(state, graph, limits, discarded);
  if (poolTruncated) {
    warnings.push(`only ${limits.maxPool} of the unplayed cards were considered`);
  }
  const legal = legalNow(state);
  const names = new Set(cards.map((c) => c.name));
  const helpful = new Map<CardName, Array<SynergyEdge>>();
  const conflicts = new Set<string>();
  const playedLinks = new Map<CardName, Array<SynergyEdge>>();
  const played = new Set(graph.nodes.filter((n) => n.zone === 'played').map((n) => n.name));
  for (const edge of graph.edges) {
    if (edge.kind === 'CONFLICTS_WITH' && edge.playFirst !== undefined) {
      // Playing `from` before `playFirst` breaks the latter.
      conflicts.add(`${edge.from}>${edge.playFirst}`);
    }
    if (!HELPFUL.has(edge.kind)) {
      continue;
    }
    if (played.has(edge.from) && names.has(edge.to)) {
      playedLinks.set(edge.to, [...(playedLinks.get(edge.to) ?? []), edge]);
    } else if (names.has(edge.from) && names.has(edge.to)) {
      helpful.set(edge.from, [...(helpful.get(edge.from) ?? []), edge]);
    }
  }
  const byName = new Map(cards.map((c) => [c.name, c]));
  const chains: Array<Array<PoolCard>> = [];
  let examined = 0;
  let stopped = false;
  const budgetLeft = () => {
    if (examined >= limits.maxChains || Date.now() - started > limits.maxMillis) {
      stopped = true;
    }
    return !stopped;
  };
  const allowed = (chain: ReadonlyArray<PoolCard>, next: PoolCard) => chain.every((earlier) => !conflicts.has(`${earlier.name}>${next.name}`));
  // Single cards that played cards already help.
  for (const card of cards) {
    if (!budgetLeft()) {
      break;
    }
    examined++;
    if ((playedLinks.get(card.name) ?? []).length > 0) {
      chains.push([card]);
    }
  }
  // Two and three cards, each new card helped by an earlier one.
  for (const first of cards) {
    for (const edge of helpful.get(first.name) ?? []) {
      if (!budgetLeft()) {
        break;
      }
      const second = byName.get(edge.to);
      if (second === undefined) {
        continue;
      }
      examined++;
      if (!allowed([first], second)) {
        continue;
      }
      chains.push([first, second]);
      for (const prior of [first, second]) {
        for (const next of helpful.get(prior.name) ?? []) {
          if (!budgetLeft()) {
            break;
          }
          const third = byName.get(next.to);
          if (third === undefined) {
            continue;
          }
          if (third.name === first.name || third.name === second.name) {
            continue;
          }
          examined++;
          if (!allowed([first, second], third)) {
            continue;
          }
          chains.push([first, second, third]);
        }
      }
    }
  }
  if (stopped) {
    warnings.push(`the search stopped at its limit (${limits.maxChains} chains or ${limits.maxMillis} ms); plans may be missing`);
  }
  const seen = new Set<string>();
  const plans: Array<CandidatePlan> = [];
  for (const chain of chains) {
    const id = chain.map((c) => c.name).join(' > ');
    if (!seen.has(id)) {
      seen.add(id);
      plans.push(evaluate(state, chain, graph, legal, playedLinks));
    }
  }
  // Spread over goals: best of each goal in turn.
  const byGoal = new Map<PlanGoal, Array<CandidatePlan>>();
  for (const plan of plans) {
    byGoal.set(plan.goal, [...(byGoal.get(plan.goal) ?? []), plan]);
  }
  byGoal.forEach((list) => list.sort(compare));
  const order: Array<PlanGoal> = ['unlock', 'engine', 'scoring', 'economy', 'terraforming'];
  const candidates: Array<CandidatePlan> = [];
  for (let round = 0; candidates.length < limits.maxCandidates; round++) {
    let added = false;
    for (const goal of order) {
      const plan = byGoal.get(goal)?.[round];
      if (plan !== undefined && candidates.length < limits.maxCandidates) {
        candidates.push(plan);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }
  return {
    candidates,
    discarded,
    warnings,
    search: {poolSize: cards.length, chainsExamined: examined, truncated: poolTruncated || stopped, elapsedMs: Date.now() - started},
  };
}
