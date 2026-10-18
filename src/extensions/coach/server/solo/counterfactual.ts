import {CardName} from '@/common/cards/CardName';
import {CoachFindingV1} from '../../common/CoachFindings';
import {costAfterDiscount} from '../analysis/discounts';
import {mechanicsOf} from '../analysis/mechanicsCatalog';
import {canPayInOrder, EvaluatedEvent, EvidenceBuilder, findingId, playableCards} from './evidence';

// CounterfactualEvaluator (P3-SOLO-2 A): a discount lost to the order of play.
//
// The player played X, then Y in the same generation. Had Y been played first, would X have cost less?
// Judged only from the snapshot before X was played (what the player could see then):
// 1. Y was offered to play at that moment (the game's "Play project card": it passed canPlay).
// 2. Y's discount on X is exact (Phase 2 costAfterDiscount, checked against the engine).
// 3. The player could pay Y and then the cheaper X from what they had then (the engine's payment rules,
//    without counting anything Y gives).
// 4. Playing Y first cannot break X's requirements (X has no maximum requirement; production cuts of
//    both cards would compete): otherwise the finding is only conditional.
// Both orders are compared in full (X may discount Y too). No engine is run and no game is copied.

export type EvaluationResult = {findings: Array<CoachFindingV1>, decisions: number, skipped: Map<string, number>};

const ACTIONS = new Set(['play-card', 'standard-project', 'card-action', 'sell-patents', 'game-option', 'pass', 'end-turn']);

function skip(skipped: Map<string, number>, reason: string) {
  skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
}

const card = (name: string) => ({text: name, card: true});

export function playOrderFindings(events: ReadonlyArray<EvaluatedEvent>): EvaluationResult {
  const result: EvaluationResult = {findings: [], decisions: 0, skipped: new Map()};
  const current = events.filter((e) => e.series === 'current');
  const plays = current.filter((e) => e.kind === 'play-card');
  for (const x of plays) {
    const laterPlays = plays.filter((y) => y.seq > x.seq && y.generation === x.generation);
    for (const y of laterPlays) {
      result.decisions++;
      const xName = x.cards[0] as CardName;
      const yName = y.cards[0] as CardName;
      const state = x.beforeState;
      if (state === undefined || !x.verified || !y.verified || x.cost === undefined || y.cost === undefined) {
        skip(result.skipped, 'decision-not-confirmed');
        continue;
      }
      const offered = playableCards(state);
      const xOffer = offered.find((o) => o.card.name === xName);
      const yOffer = offered.find((o) => o.card.name === yName);
      if (xOffer === undefined || yOffer === undefined || yOffer.card.calculatedCost === undefined) {
        skip(result.skipped, 'later-card-not-playable-then');
        continue;
      }
      const discounted = costAfterDiscount(state, xOffer.card, xOffer.path, yName);
      if (discounted.cost === 'unknown') {
        skip(result.skipped, 'discount-not-modeled');
        continue;
      }
      const xCost = x.cost;
      if (discounted.cost >= xCost) {
        skip(result.skipped, 'no-discount');
        continue;
      }
      const yCostThen = yOffer.card.calculatedCost;
      const actualTotal = xCost + y.cost;
      const alternativeTotal = yCostThen + discounted.cost;
      const saved = actualTotal - alternativeTotal;
      if (saved <= 0) {
        skip(result.skipped, 'actual-order-not-worse');
        continue;
      }
      const payable = canPayInOrder(state, {card: yName, cost: yCostThen}, {card: xName, cost: discounted.cost});
      if (payable === false) {
        skip(result.skipped, 'alternative-not-payable');
        continue;
      }

      const limits: Array<string> = ['effects-of-the-cards-not-compared', 'resources-gained-by-the-first-card-not-counted'];
      const xMechanics = mechanicsOf(xName);
      const yMechanics = mechanicsOf(yName);
      const xHasMax = xMechanics?.requirements.some((r) => r.kind === 'unsupported' || ('max' in r && r.max)) ?? true;
      const bothCutProduction = (xMechanics?.atoms ?? []).some((a) => a.kind === 'production' && a.amount < 0) &&
        (yMechanics?.atoms ?? []).some((a) => a.kind === 'production' && a.amount < 0);
      // Between X and Y, did the player do something else? Then Y's cost or X's position may differ.
      const between = current.filter((e) => e.seq > x.seq && e.seq < y.seq && ACTIONS.has(e.kind));
      const conditional = xHasMax || bothCutProduction || between.length > 0 || payable === 'unknown' || discounted.support.level !== 'verified';
      if (xHasMax) {
        limits.push('first-card-may-break-a-requirement');
      }
      if (bothCutProduction) {
        limits.push('both-cards-lower-production');
      }
      if (between.length > 0) {
        limits.push('other-actions-between-the-plays');
      }
      if (payable === 'unknown') {
        limits.push('payment-with-cards-not-counted');
      }

      const evidence = new EvidenceBuilder();
      evidence.add('cost', {seq: x.seq, position: 'before'}, {card: xName, cost: xCost});
      evidence.add('offered', {seq: x.seq, position: 'before'}, {card: yName, playable: true, cost: yCostThen});
      evidence.add('discount', {catalog: yName, analysis: 'costAfterDiscount'}, {discountCard: yName, target: xName, costBefore: xCost, costAfter: discounted.cost}, discounted.support.level === 'verified' ? 'verified' : 'conditional');
      evidence.add('cost', {seq: y.seq, position: 'before'}, {card: yName, cost: y.cost});
      evidence.add('resources', {seq: x.seq, position: 'before'}, {megacredits: state.me.resources.megacredits, steel: state.me.resources.steel, titanium: state.me.resources.titanium, heat: state.me.resources.heat});
      evidence.add('payment-check', {seq: x.seq, position: 'before', analysis: 'canPayInOrder'}, {first: yName, firstCost: yCostThen, second: xName, secondCost: discounted.cost, payable}, payable === true ? 'verified' : 'unknown');

      result.findings.push({
        id: findingId('play-order-discount', [x.seq, y.seq]),
        kind: 'play-order-discount',
        decision: {eventId: x.id, seq: x.seq, generation: x.generation},
        related: [y.id],
        actual: {summary: {template: '${0} then ${1}', params: [card(xName), card(yName)]}, megacredits: actualTotal},
        alternative: {summary: {template: '${0} then ${1}', params: [card(yName), card(xName)]}, megacredits: alternativeTotal},
        difference: {megacredits: saved},
        evidence: evidence.items,
        confidence: conditional ? 'conditional' : 'verified',
        unmodeled: [],
        limits,
        intervention: false,
        severity: saved >= 3 ? 'notable' : 'minor',
      });
    }
  }
  return result;
}
