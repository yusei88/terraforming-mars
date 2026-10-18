import {CardName} from '@/common/cards/CardName';
import {analyzeRequirements} from '../analysis/requirements';
import {mechanicsOf} from '../analysis/mechanicsCatalog';
import {EvaluatedEvent, EvidenceBuilder, findingId} from './evidence';
import {EvaluationResult} from './counterfactual';

// Purchases that could not be played (P3-SOLO-2 B), judged at the moment of the purchase.
//
// - verified: a maximum requirement of the card was already exceeded when it was bought. Global
//   parameters never go down, so the card could never be played: its purchase cost bought nothing.
// - conditional (never a question to the player): bought in the last generation while a requirement was
//   not met yet. Whether it could still be played depends on later draws and actions.
// A card that was played later is never judged, and a card that is simply still in hand is not a fault.

const card = (name: string) => ({text: name, card: true});

export function purchaseFindings(events: ReadonlyArray<EvaluatedEvent>): EvaluationResult {
  const result: EvaluationResult = {findings: [], decisions: 0, skipped: new Map()};
  const skip = (reason: string) => result.skipped.set(reason, (result.skipped.get(reason) ?? 0) + 1);
  const current = events.filter((e) => e.series === 'current');
  for (const buy of current.filter((e) => e.kind === 'buy-cards' || e.kind === 'initial-selection')) {
    const state = buy.beforeState;
    for (const name of buy.cards) {
      result.decisions++;
      if (state === undefined || !buy.verified) {
        skip('decision-not-confirmed');
        continue;
      }
      if (current.some((e) => e.kind === 'play-card' && e.seq > buy.seq && e.cards.includes(name))) {
        skip('played-later');
        continue;
      }
      const mechanics = mechanicsOf(name as CardName);
      if (mechanics === undefined) {
        skip('card-not-in-catalog');
        continue;
      }
      const gaps = analyzeRequirements(state, mechanics);
      const impossible = gaps.find((g) => g.permanentlyUnmet === true);
      const lastGeneration = state.game.generation >= state.game.lastSoloGeneration;
      const unmet = gaps.find((g) => g.status === 'unmet');
      if (impossible === undefined && !(lastGeneration && unmet !== undefined)) {
        skip('no-evidence-of-a-problem');
        continue;
      }
      const evidence = new EvidenceBuilder();
      evidence.add('purchase', {seq: buy.seq, position: 'before'}, {card: name, generation: state.game.generation, cardCost: state.me.cardCost, lastGeneration: state.game.lastSoloGeneration});
      const gap = impossible ?? unmet;
      if (gap !== undefined) {
        evidence.add('requirement', {seq: buy.seq, position: 'before', analysis: 'analyzeRequirements'}, {
          card: name, kind: gap.kind, current: gap.observed, target: gap.target, comparator: gap.comparator, gap: gap.gap, permanentlyUnmet: gap.permanentlyUnmet === true,
        }, gap.status === 'conditional' ? 'conditional' : 'verified');
      }
      const verified = impossible !== undefined && impossible.status !== 'conditional';
      result.findings.push({
        id: findingId('unplayable-purchase', [buy.seq], name),
        kind: 'unplayable-purchase',
        decision: {eventId: buy.id, seq: buy.seq, generation: buy.generation},
        related: [],
        actual: {summary: {template: 'Bought ${0}', params: [card(name)]}, megacredits: state.me.cardCost},
        alternative: {summary: {template: 'Not buying ${0}', params: [card(name)]}, megacredits: 0},
        difference: {megacredits: state.me.cardCost},
        evidence: evidence.items,
        confidence: verified ? 'verified' : 'conditional',
        unmodeled: [],
        limits: verified ? ['value-of-keeping-the-card-not-counted'] : ['later-draws-and-actions-unknown', 'value-of-keeping-the-card-not-counted'],
        intervention: false,
        severity: 'minor',
      });
    }
  }
  return result;
}
