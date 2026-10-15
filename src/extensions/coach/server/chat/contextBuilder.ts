import {CoachAnalysisV1, CandidatePlan} from '../../common/CoachAnalysis';
import {CoachLLMContext, CoachLLMPlan} from '../../common/CoachChat';
import {CoachCardInstance, CoachChoice, CoachStateV1} from '../../common/CoachState';

// Builds the context the language model sees from the player's own CoachState and analysis.
//
// Only what the player can see on their own screen goes in, and only what a strategy talk needs: no
// player, game or spectator id, no names of people, no hidden cards of others, no deck order, no board
// spaces, no history. Plans get short aliases (P1…) so that server plan ids never leave the server.

/** The context plus the map from aliases to the server's plan ids (kept on the server). */
export type BuiltContext = {
  context: CoachLLMContext,
  planIds: ReadonlyMap<string, string>,
};

function cost(card: CoachCardInstance): number | 'unknown' {
  return card.calculatedCost ?? 'unknown';
}

function offered(choice: CoachChoice | undefined, out: Array<CoachCardInstance>): void {
  if (choice === undefined) {
    return;
  }
  if (choice.inputType === 'card' || choice.inputType === 'projectCard') {
    out.push(...(choice.cards ?? []));
  }
  (choice.options ?? []).forEach((option) => offered(option, out));
}

function plan(candidate: CandidatePlan, alias: string): CoachLLMPlan {
  const forecast = candidate.forecast;
  const last = forecast?.deltas[forecast.deltas.length - 1];
  return {
    id: alias,
    goal: candidate.goal,
    goals: candidate.goals,
    support: candidate.support.level,
    assumptions: candidate.support.level === 'conditional' ? candidate.support.assumptions : [],
    cards: candidate.cards.map((card) => ({
      name: card.name, zone: card.zone, availability: card.availability, cost: card.cost,
      ...(card.purchaseCost === undefined ? {} : {purchaseCost: card.purchaseCost}),
    })),
    links: candidate.links.map((link) => ({
      kind: link.kind, from: link.from, to: link.to,
      ...(link.amount === undefined ? {} : {amount: link.amount}),
      ...(link.completes === undefined ? {} : {completes: link.completes}),
      ...(link.alreadyApplied === undefined ? {} : {alreadyApplied: link.alreadyApplied}),
      ...(link.playFirst === undefined ? {} : {playFirst: link.playFirst}),
    })),
    blockers: candidate.blockers.map((b) => ({
      card: b.card, kind: b.kind, observed: b.observed, target: b.target, gap: b.gap, status: b.status,
      ...(b.permanentlyUnmet ? {permanentlyUnmet: true} : {}),
    })),
    payments: candidate.payments,
    ...(forecast === undefined ? {} : {forecast: {
      productionPhases: forecast.productionPhases,
      productionsLeft: forecast.productionsLeft,
      complete: forecast.complete,
      afterLastProduction: last === undefined ? undefined : {resources: last.resources, production: last.production, terraformRating: last.terraformRating},
      megacredits: forecast.megacredits,
      victoryPoints: forecast.victoryPoints,
      unmodeledEffects: forecast.unmodeledEffects,
    }}),
  };
}

export function buildContext(state: CoachStateV1, analysis: CoachAnalysisV1): BuiltContext {
  const planIds = new Map<string, string>();
  const plans = analysis.candidates.map((candidate, i) => {
    const alias = `P${i + 1}`;
    planIds.set(alias, candidate.id);
    return plan(candidate, alias);
  });
  const root = state.choices.status === 'awaiting-input' ? state.choices.root : undefined;
  const offer: Array<CoachCardInstance> = [];
  offered(root, offer);
  const handNames = new Set(state.me.hand.map((card) => card.name));
  const game = state.game;
  const context: CoachLLMContext = {
    game: {
      mode: game.mode,
      playerCount: game.playerCount,
      generation: game.generation,
      phase: game.phase,
      ...(game.mode === 'solo' ? {lastGeneration: game.lastSoloGeneration} : {}),
      temperature: {value: game.temperature.value, max: game.temperature.max},
      oxygen: {value: game.oxygen.value, max: game.oxygen.max},
      oceans: {value: game.oceans.value, max: game.oceans.max},
      gameOver: game.gameOver,
    },
    me: {
      color: state.me.color,
      terraformRating: state.me.terraformRating,
      resources: state.me.resources,
      production: state.me.production,
      steelValue: state.me.steelValue,
      titaniumValue: state.me.titaniumValue,
      tags: state.me.tags as Record<string, number>,
      corporations: state.me.corporations,
      played: state.me.tableau.map((card) => card.name),
      hand: state.me.hand.map((card) => ({name: card.name, cost: cost(card)})),
      // Cards offered now (to buy, draft or play) that are not already listed in the hand.
      offered: offer.filter((card) => !handNames.has(card.name)).map((card) => ({name: card.name, cost: cost(card)})),
    },
    opponents: state.opponents.map((p) => ({
      color: p.color,
      terraformRating: p.terraformRating,
      production: p.production,
      tags: p.tags as Record<string, number>,
      cardsInHand: p.cardsInHandCount,
      played: p.tableau.map((card) => card.name),
    })),
    now: {
      status: state.choices.status,
      options: root === undefined ? [] : [root.title, ...(root.options ?? []).map((option) => option.title)],
    },
    analysis: {
      horizonProductionPhases: analysis.horizonProductionPhases,
      plans,
      coverage: {supported: analysis.coverage.supported, partial: analysis.coverage.partial, unsupported: analysis.coverage.unsupported},
      searchTruncated: analysis.search.truncated,
      warnings: analysis.warnings,
      limitations: analysis.limitations,
    },
  };
  return {context, planIds};
}

/** Every card name the context mentions (the only card names an answer may use). */
export function contextCardNames(context: CoachLLMContext): Set<string> {
  const names = new Set<string>([
    ...context.me.corporations, ...context.me.played,
    ...context.me.hand.map((c) => c.name), ...context.me.offered.map((c) => c.name),
    ...context.opponents.flatMap((p) => p.played),
  ]);
  for (const p of context.analysis.plans) {
    p.cards.forEach((c) => names.add(c.name));
    p.links.forEach((l) => {
      names.add(l.from);
      names.add(l.to);
    });
  }
  return names;
}
