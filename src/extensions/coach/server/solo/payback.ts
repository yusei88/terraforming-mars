import {CardName} from '@/common/cards/CardName';
import {CandidatePlan} from '../../common/CoachAnalysis';
import {forecastPlan, productionsLeft} from '../analysis/forecast';
import {mechanicsOf} from '../analysis/mechanicsCatalog';
import {EvaluatedEvent, EvidenceBuilder, findingId} from './evidence';
import {EvaluationResult} from './counterfactual';

// Production investments that do not pay back (P3-SOLO-2 C), judged at the moment of the play.
//
// Only when at most 3 production phases were left (the Phase 2 forecast then covers the rest of the
// game exactly, with the solo end known). The forecast counts the cost, M€ income and TR income.
// - verified: every effect is modeled, the card raises only M€ production, gives no VP and no TR, and
//   the M€ paid does not come back before the game ends.
// - conditional (never a question): VP, TR, other productions (heat and plants terraform in solo),
//   unmodeled effects: a pure M€ balance would miss them, so it is not a verdict.

const card = (name: string) => ({text: name, card: true});

function singleCardPlan(name: CardName, cost: number): CandidatePlan {
  return {
    id: name, goal: 'economy', goals: ['economy'],
    cards: [{name, zone: 'hand', availability: 'legal-now', reasons: [], cost}],
    links: [], blockers: [], payments: {play: cost, purchase: 0},
    support: {level: 'verified', evidence: []}, question: {key: '', params: {}, text: ''},
  };
}

export function paybackFindings(events: ReadonlyArray<EvaluatedEvent>): EvaluationResult {
  const result: EvaluationResult = {findings: [], decisions: 0, skipped: new Map()};
  const skip = (reason: string) => result.skipped.set(reason, (result.skipped.get(reason) ?? 0) + 1);
  for (const play of events.filter((e) => e.series === 'current' && e.kind === 'play-card')) {
    const name = play.cards[0] as CardName;
    const mechanics = mechanicsOf(name);
    if (mechanics === undefined || !mechanics.atoms.some((a) => a.kind === 'production' && a.amount > 0 && a.source === 'onPlay')) {
      continue;
    }
    result.decisions++;
    const state = play.beforeState;
    if (state === undefined || !play.verified || play.cost === undefined) {
      skip('decision-not-confirmed');
      continue;
    }
    const left = productionsLeft(state);
    if (left === 'unknown' || left > 3) {
      skip('many-production-phases-left');
      continue;
    }
    const forecast = forecastPlan(state, singleCardPlan(name, play.cost), left);
    const last = forecast.deltas[forecast.deltas.length - 1];
    const otherProduction = Object.entries(last.production).some(([resource, amount]) => resource !== 'megacredits' && amount !== 0);
    const vp = forecast.victoryPoints === 'unknown' ? undefined : forecast.victoryPoints.total;
    const tr = forecast.deltas[0].terraformRating;
    const pure = forecast.complete && forecast.megacredits !== 'unknown' && !otherProduction && vp === 0 && tr === 0;
    if (forecast.megacredits !== 'unknown' && forecast.megacredits.recovered) {
      skip('paid-back');
      continue;
    }
    if (forecast.megacredits === 'unknown' && !pure) {
      // Nothing can be said about the balance at all.
      skip('balance-not-modeled');
      continue;
    }
    const balance = forecast.megacredits === 'unknown' ? undefined : forecast.megacredits;
    const evidence = new EvidenceBuilder();
    evidence.add('cost', {seq: play.seq, position: 'before'}, {card: name, cost: play.cost});
    evidence.add('forecast', {seq: play.seq, position: 'before', analysis: 'forecastPlan'}, {
      card: name, productionPhasesLeft: left, productionChange: last.production, terraformRating: tr, victoryPoints: vp ?? 'unknown',
      returned: balance?.returned ?? 'unknown', balance: balance?.balance ?? 'unknown', complete: forecast.complete,
    }, pure ? 'verified' : 'conditional');
    const limits: Array<string> = [];
    if (otherProduction) {
      limits.push('other-productions-not-valued-in-megacredits');
    }
    if (vp !== 0) {
      limits.push('victory-points-not-weighed');
    }
    if (tr !== 0) {
      limits.push('terraform-rating-not-weighed');
    }
    if (!forecast.complete) {
      limits.push('unmodeled-effects');
    }
    const shortfall = balance === undefined ? undefined : -balance.balance;
    result.findings.push({
      id: findingId('production-payback', [play.seq]),
      kind: 'production-payback',
      decision: {eventId: play.id, seq: play.seq, generation: play.generation},
      related: [],
      actual: {summary: {template: 'Played ${0}', params: [card(name)]}, megacredits: balance?.returned},
      alternative: {summary: {template: 'Not playing ${0}', params: [card(name)]}, megacredits: 0},
      ...(shortfall === undefined ? {} : {difference: {megacredits: shortfall}}),
      evidence: evidence.items,
      confidence: pure ? 'verified' : 'conditional',
      unmodeled: forecast.unmodeledEffects,
      limits,
      intervention: false,
      severity: (shortfall ?? 0) >= 5 ? 'notable' : 'minor',
    });
  }
  return result;
}
