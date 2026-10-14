import {CoachStateV1} from '../../common/CoachState';
import {Evidence, RequirementGap} from '../../common/CoachAnalysis';
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {catalogCard} from '../cardCatalog';
import {mechanicsOf} from './mechanicsCatalog';

// What the player can pay for a project card, with the engine's payment rules (Player.paymentOptionsForCard):
// M€, steel for building cards, titanium for space cards (at their current values), heat with Helion.
// Other ways to pay (cards in play that allow plants, microbes, floaters…) are reported as assumptions,
// never silently added: the answer is then `conditional`.

// Cards that let a player pay with something the analysis does not count.
const OTHER_PAYMENT_CARDS: ReadonlyArray<CardName> = [
  CardName.MARTIAN_LUMBER_CORP, CardName.PSYCHROPHILES, CardName.DIRIGIBLES, CardName.LUNA_ARCHIVES,
  CardName.LUNA_TRADE_FEDERATION, CardName.SOYLENT_SEEDLING_SYSTEMS, CardName.CARBON_NANOSYSTEMS,
  CardName.KUIPER_COOPERATIVE, CardName.AURORAI, CardName.SPIRE, CardName.LAST_RESORT_INGENUITY,
];

/** What the player could pay towards `cost` for `card`, as a `cost` requirement gap. */
export function affordability(state: CoachStateV1, card: CardName, cost: number | 'unknown', costPath: string): RequirementGap {
  const evidence: Array<Evidence> = [{kind: 'state', fieldPath: 'me.resources.megacredits', stateFingerprint: state.fingerprint}];
  if (cost === 'unknown') {
    return {kind: 'cost', observed: 'unknown', target: 'unknown', comparator: '>=', gap: 'unknown', status: 'unsupported', assumptions: ['the cost is not known'], evidence};
  }
  evidence.push({kind: 'state', fieldPath: costPath, cardName: card, stateFingerprint: state.fingerprint});
  const tags = catalogCard(card)?.tags ?? [];
  const me = state.me;
  let power = me.resources.megacredits;
  if (tags.includes(Tag.BUILDING)) {
    power += me.resources.steel * me.steelValue;
    evidence.push({kind: 'state', fieldPath: 'me.resources.steel', stateFingerprint: state.fingerprint});
  }
  if (tags.includes(Tag.SPACE)) {
    power += me.resources.titanium * me.titaniumValue;
    evidence.push({kind: 'state', fieldPath: 'me.resources.titanium', stateFingerprint: state.fingerprint});
  }
  const tableau = new Set(me.tableau.map((c) => c.name));
  if (tableau.has(CardName.HELION)) {
    power += me.resources.heat;
    evidence.push({kind: 'state', fieldPath: 'me.resources.heat', stateFingerprint: state.fingerprint});
  }
  const assumptions: Array<string> = [];
  for (const other of OTHER_PAYMENT_CARDS) {
    if (tableau.has(other)) {
      assumptions.push(`${other} may allow other ways to pay`);
    }
  }
  if (mechanicsOf(card)?.unmodeled.some((u) => u.key === 'reserveUnits')) {
    assumptions.push(`${card} needs resources left over after paying`);
  }
  if (state.game.unsupported.length > 0) {
    assumptions.push('expansions not covered by the analysis may change costs (e.g. Reds)');
  }
  const gap: RequirementGap = {
    kind: 'cost', observed: power, target: cost, comparator: '>=', gap: Math.max(0, cost - power),
    status: assumptions.length > 0 ? 'conditional' : power >= cost ? 'met' : 'unmet',
    evidence,
  };
  if (assumptions.length > 0) {
    gap.assumptions = assumptions;
  }
  return gap;
}
