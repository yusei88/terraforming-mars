import {createHash} from 'crypto';
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {CoachCardInstance, CoachChoice, CoachStateV1} from '../../common/CoachState';
import {FindingEvidence, FindingKind} from '../../common/CoachFindings';
import {catalogCard} from '../cardCatalog';

// EvidenceBuilder and shared checks of the solo evaluators (P3-SOLO-2). Values come from recorded
// snapshots, the card catalog and the Phase 2 analysis only.

export class EvidenceBuilder {
  public readonly items: Array<FindingEvidence> = [];

  public add(kind: FindingEvidence['kind'], source: FindingEvidence['source'], value: Record<string, unknown>, support: FindingEvidence['support'] = 'verified'): FindingEvidence {
    const item: FindingEvidence = {id: `E${this.items.length + 1}`, kind, source, value, support};
    this.items.push(item);
    return item;
  }
}

/** Stable id of a finding: the same decisions of the same history give the same id. */
export function findingId(kind: FindingKind, seqs: ReadonlyArray<number>, detail = ''): string {
  return createHash('sha256').update([kind, ...seqs, detail].join('|')).digest('hex').slice(0, 16);
}

/** The cards the game offered to play from hand at this moment ("Play project card"), with their paths. */
export function playableCards(state: CoachStateV1): Array<{card: CoachCardInstance, path: string}> {
  const out: Array<{card: CoachCardInstance, path: string}> = [];
  const walk = (choice: CoachChoice | undefined) => {
    if (choice === undefined) {
      return;
    }
    if (choice.inputType === 'projectCard' && choice.title !== 'Standard projects') {
      (choice.cards ?? []).forEach((card, i) => out.push({card, path: `choices.root${choice.path === '' ? '' : '.' + choice.path}.cards[${i}]`}));
    }
    (choice.options ?? []).forEach(walk);
  };
  walk(state.choices.status === 'awaiting-input' ? state.choices.root : undefined);
  return out;
}

type Wallet = {megacredits: number, steel: number, titanium: number, heat: number};

/** Ways to pay `cost` for `card` from `wallet` with the engine's rules (M€, steel for building, titanium for space, heat with Helion). */
function payments(state: CoachStateV1, card: CardName, cost: number, wallet: Wallet): Array<Wallet> {
  const tags = catalogCard(card)?.tags ?? [];
  const steel = tags.includes(Tag.BUILDING) ? wallet.steel : 0;
  const titanium = tags.includes(Tag.SPACE) ? wallet.titanium : 0;
  const heat = state.me.tableau.some((c) => c.name === CardName.HELION) ? wallet.heat : 0;
  const out: Array<Wallet> = [];
  for (let s = 0; s <= steel; s++) {
    for (let t = 0; t <= titanium; t++) {
      const afterAlloys = Math.max(0, cost - s * state.me.steelValue - t * state.me.titaniumValue);
      for (let h = 0; h <= Math.min(heat, afterAlloys); h++) {
        const megacredits = afterAlloys - h;
        if (megacredits <= wallet.megacredits) {
          out.push({megacredits: wallet.megacredits - megacredits, steel: wallet.steel - s, titanium: wallet.titanium - t, heat: wallet.heat - h});
        }
        if (out.length > 2000) {
          return out;
        }
      }
    }
  }
  return out;
}

/**
 * Whether the player could pay `first` and then `second` from what they had in `state` (without counting
 * anything the first card gives). `unknown` when the player may also pay with cards the check does not
 * count (and could not pay without them).
 */
export function canPayInOrder(state: CoachStateV1, first: {card: CardName, cost: number}, second: {card: CardName, cost: number}): boolean | 'unknown' {
  const r = state.me.resources;
  const start: Wallet = {megacredits: r.megacredits, steel: r.steel, titanium: r.titanium, heat: r.heat};
  for (const left of payments(state, first.card, first.cost, start)) {
    if (payments(state, second.card, second.cost, left).length > 0) {
      return true;
    }
  }
  const otherWays = state.me.tableau.some((c) => [CardName.MARTIAN_LUMBER_CORP, CardName.PSYCHROPHILES, CardName.DIRIGIBLES].includes(c.name));
  return otherWays ? 'unknown' : false;
}

/** Events of the current line of play, as the evaluators use them. */
export type EvaluatedEvent = {
  id: string, seq: number, kind: string, generation: number, phase: string, series: string,
  cards: ReadonlyArray<string>, cost?: number, verified: boolean, beforeState?: CoachStateV1,
};
