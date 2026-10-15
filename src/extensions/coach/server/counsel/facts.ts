import {CandidatePlan, CoachAnalysisV1, SynergyEdge} from '../../common/CoachAnalysis';
import {CoachStateV1} from '../../common/CoachState';
import {CoachFact, FactSupport} from '../../common/CoachCounsel';
import {ChoiceEntry} from '../choices/choicePresenter';

// The facts about a chosen option, taken from the game state and the analysis only (no model, no guess).
// Every coaching point, from templates or from the model, has to name the facts it rests on.

/** What the coaching of one choice needs, with the ids of the facts. */
export type ChoiceFacts = {
  entry: ChoiceEntry,
  cost?: CoachFact,
  plans: Array<{plan: CandidatePlan, fact: CoachFact}>,
  links: Array<{edge: SynergyEdge, fact: CoachFact}>,
  blockers: Array<CoachFact>,
  /** Forecast of the plan of this card alone (project card) or of the plan (strategy plan). */
  forecast?: CoachFact,
  forecastPlan?: CandidatePlan,
  unmodeled?: CoachFact,
  option?: CoachFact,
  /** True when the analysis says nothing about this card. */
  notInAnalysis: boolean,
};

function supportOf(plan: CandidatePlan): FactSupport {
  return plan.support.level === 'verified' ? 'verified' : plan.support.level === 'conditional' ? 'conditional' : 'unknown';
}

export class FactCollector {
  public readonly facts: Array<CoachFact> = [];

  public add(about: CoachFact['about'], kind: CoachFact['kind'], value: Record<string, unknown>, support: FactSupport): CoachFact {
    const fact: CoachFact = {id: `F${this.facts.length + 1}`, about, kind, value, support};
    this.facts.push(fact);
    return fact;
  }
}

/** Facts about the position that every choice shares (generation, globals, own resources). */
export function gameFacts(collector: FactCollector, state: CoachStateV1): {game: CoachFact, resources: CoachFact} {
  const g = state.game;
  const game = collector.add('game', 'game', {
    generation: g.generation,
    ...(g.mode === 'solo' ? {lastGeneration: g.lastSoloGeneration} : {}),
    mode: g.mode,
    phase: g.phase,
    temperature: g.temperature.value,
    oxygen: g.oxygen.value,
    oceans: g.oceans.value,
  }, 'verified');
  const me = state.me;
  const resources = collector.add('game', 'resources', {
    megacredits: me.resources.megacredits, steel: me.resources.steel, steelValue: me.steelValue,
    titanium: me.resources.titanium, titaniumValue: me.titaniumValue, plants: me.resources.plants,
    energy: me.resources.energy, heat: me.resources.heat, production: me.production, terraformRating: me.terraformRating,
  }, 'verified');
  return {game, resources};
}

function forecastValue(plan: CandidatePlan): Record<string, unknown> | undefined {
  const f = plan.forecast;
  if (f === undefined) {
    return undefined;
  }
  const last = f.deltas[f.deltas.length - 1];
  return {
    cards: plan.cards.map((c) => c.name),
    productionPhases: f.productionPhases,
    productionsLeft: f.productionsLeft,
    complete: f.complete,
    productionChange: last?.production,
    resourcesChange: last?.resources,
    terraformRatingChange: last?.terraformRating,
    megacredits: f.megacredits,
    victoryPoints: f.victoryPoints,
  };
}

function linkValue(edge: SynergyEdge): Record<string, unknown> {
  return {
    kind: edge.kind, from: edge.from, to: edge.to,
    ...(edge.amount === undefined ? {} : {amount: edge.amount}),
    ...(edge.completes === undefined ? {} : {completes: edge.completes}),
    ...(edge.alreadyApplied === undefined ? {} : {alreadyApplied: edge.alreadyApplied}),
    ...(edge.playFirst === undefined ? {} : {playFirst: edge.playFirst}),
  };
}

function addPlanDetails(collector: FactCollector, about: 'A' | 'B', plan: CandidatePlan, out: ChoiceFacts, linkFilter: (e: SynergyEdge) => boolean) {
  const seen = new Set(out.links.map((l) => `${l.edge.kind}|${l.edge.from}|${l.edge.to}`));
  for (const edge of plan.links.filter(linkFilter)) {
    const key = `${edge.kind}|${edge.from}|${edge.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.links.push({edge, fact: collector.add(about, 'link', linkValue(edge), edge.support.level === 'verified' ? 'verified' : 'conditional')});
    }
  }
}

/** Facts of one choice. */
export function choiceFacts(collector: FactCollector, about: 'A' | 'B', entry: ChoiceEntry, state: CoachStateV1, analysis: CoachAnalysisV1): ChoiceFacts {
  const out: ChoiceFacts = {entry, plans: [], links: [], blockers: [], notInAnalysis: false};
  const option = entry.option;
  const megacredits = state.me.resources.megacredits;

  if (option.kind === 'project-card' || option.kind === 'standard-project') {
    const name = entry.cardName ?? '';
    if (option.cost !== undefined) {
      out.cost = collector.add(about, 'cost', {card: name, cost: option.cost, megacredits, megacreditsAfterPayingInMegacredits: megacredits - option.cost}, 'verified');
    }
    if (option.kind === 'project-card') {
      const starting = analysis.candidates.filter((p) => p.cards[0]?.name === name);
      const alone = starting.find((p) => p.cards.length === 1);
      for (const plan of starting.filter((p) => p.cards.length > 1).slice(0, 3)) {
        out.plans.push({plan, fact: collector.add(about, 'plan', {goal: plan.goal, cards: plan.cards.map((c) => ({name: c.name, availability: c.availability, cost: c.cost})), payments: plan.payments}, supportOf(plan))});
      }
      for (const plan of starting) {
        addPlanDetails(collector, about, plan, out, (e) => e.from === name || e.to === name);
      }
      if (alone !== undefined) {
        const value = forecastValue(alone);
        if (value !== undefined) {
          out.forecast = collector.add(about, 'forecast', value, alone.forecast?.complete ? supportOf(alone) : 'conditional');
          out.forecastPlan = alone;
          if ((alone.forecast?.unmodeledEffects.length ?? 0) > 0) {
            out.unmodeled = collector.add(about, 'unmodeled', {card: name, count: alone.forecast?.unmodeledEffects.length}, 'unknown');
          }
        }
      }
      out.notInAnalysis = starting.length === 0;
    }
  } else if (option.kind === 'game-option') {
    out.option = collector.add(about, 'option', {text: entry.text}, 'verified');
  } else if (option.kind === 'strategy-plan' && entry.plan !== undefined) {
    const plan = entry.plan;
    out.plans.push({plan, fact: collector.add(about, 'plan', {
      goal: plan.goal,
      cards: plan.cards.map((c) => ({name: c.name, availability: c.availability, cost: c.cost, ...(c.purchaseCost === undefined ? {} : {purchaseCost: c.purchaseCost})})),
      payments: plan.payments,
    }, supportOf(plan))});
    addPlanDetails(collector, about, plan, out, () => true);
    for (const b of plan.blockers) {
      out.blockers.push(collector.add(about, 'blocker', {card: b.card, kind: b.kind, current: b.observed, target: b.target, stillMissingInThisPlan: b.gap, status: b.status}, b.status === 'unsupported' ? 'unknown' : b.status === 'conditional' ? 'conditional' : 'verified'));
    }
    const value = forecastValue(plan);
    if (value !== undefined) {
      out.forecast = collector.add(about, 'forecast', value, plan.forecast?.complete ? supportOf(plan) : 'conditional');
      out.forecastPlan = plan;
      if ((plan.forecast?.unmodeledEffects.length ?? 0) > 0) {
        out.unmodeled = collector.add(about, 'unmodeled', {cards: plan.cards.map((c) => c.name), count: plan.forecast?.unmodeledEffects.length}, 'unknown');
      }
    }
  }
  return out;
}
