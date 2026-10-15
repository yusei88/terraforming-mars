import {CoachChoiceOption} from '../common/CoachChoiceList';
import {CoachFact} from '../common/CoachCounsel';
import {blockerLine, DisplayLine, linkLine, signed} from '../common/coachText';
import {RequirementGap, SynergyEdge} from '../common/CoachAnalysis';

// Display of the choice-driven coach (P3-CD-1): labels of options and limitation codes, and the facts of
// a review as fixed English templates (translated in src/extensions/coach/locales).

const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  megacredits: 'Megacredits', steel: 'Steel', titanium: 'Titanium', plants: 'Plants', energy: 'Energy', heat: 'Heat',
};

const LIMITATIONS: Readonly<Record<string, string>> = {
  'no-quantitative-analysis': 'Not analysed in numbers',
  'undo': 'Not reviewed',
  'kind-not-supported-yet': 'Not supported yet',
  'card-selection': 'A selection of cards, not one move',
  'compound-input': 'Several answers at once, not one move',
  'input-not-analysed': 'Not analysed',
  'plan-not-one-move': 'Needs more than one move',
  'based-on-assumptions': 'Based on assumptions',
  'forecast-incomplete': 'Forecast incomplete',
  'search-truncated': 'Search stopped at its limits',
};

export function limitationLabel(code: string): string {
  return LIMITATIONS[code] ?? 'Not analysed';
}

export function eligibilityLabel(eligibility: CoachChoiceOption['eligibility']): string {
  switch (eligibility) {
  case 'legal-now': return 'Playable now';
  case 'conditional': return 'Later';
  case 'unknown': return 'Cannot check';
  case 'not-action': return 'Not a single move';
  }
}

const value = (n: unknown) => ({text: typeof n === 'number' ? String(n) : String(n ?? '')});
const card = (name: unknown) => ({text: String(name), card: true});

function productionLines(change: unknown): Array<DisplayLine> {
  const lines: Array<DisplayLine> = [];
  for (const [resource, amount] of Object.entries((change ?? {}) as Record<string, number>)) {
    if (amount !== 0) {
      lines.push({template: 'Production of ${0}: ${1}', params: [card(RESOURCE_NAMES[resource] ?? resource), value(signed(amount))]});
    }
  }
  return lines;
}

/** The lines of one fact. */
export function factLines(fact: CoachFact): Array<DisplayLine> {
  const v = fact.value as Record<string, unknown>;
  switch (fact.kind) {
  case 'game':
    return [v.lastGeneration === undefined ?
      {template: 'Generation ${0}', params: [value(v.generation)]} :
      {template: 'Generation ${0} of ${1}', params: [value(v.generation), value(v.lastGeneration)]}];
  case 'resources':
    return [{template: 'You have ${0} M€, ${1} steel (worth ${2} each) and ${3} titanium (worth ${4} each)',
      params: [value(v.megacredits), value(v.steel), value(v.steelValue), value(v.titanium), value(v.titaniumValue)]}];
  case 'cost':
    return [{template: '${0}: cost ${1} M€', params: [card(v.card), value(v.cost)]}];
  case 'option':
    return [{template: 'A fixed action of the game (not analysed in numbers)', params: []}];
  case 'plan': {
    const cards = (v.cards as Array<{name: string}>) ?? [];
    return cards.map((c, i) => ({template: i === 0 ? 'Plan: ${0}' : 'then ${0}', params: [card(c.name)]}));
  }
  case 'link':
    return [linkLine(v as unknown as SynergyEdge)];
  case 'blocker':
    return [blockerLine({card: v.card, kind: v.kind, observed: v.current, target: v.target, gap: v.stillMissingInThisPlan, status: v.status} as unknown as RequirementGap & {card: string})];
  case 'forecast': {
    const lines: Array<DisplayLine> = [{template: 'Over ${0} production phases', params: [value(v.productionPhases)]}, ...productionLines(v.productionChange)];
    if (typeof v.terraformRatingChange === 'number' && v.terraformRatingChange !== 0) {
      lines.push({template: 'Terraform rating: ${0}', params: [value(signed(v.terraformRatingChange))]});
    }
    const mc = v.megacredits as {recovered: boolean} | 'unknown';
    lines.push(v.complete !== true || mc === 'unknown' ?
      {template: 'Some effects are not modeled: totals are not shown', params: []} :
      {template: mc.recovered ? 'Paid back within this horizon' : 'Not paid back within this horizon', params: []});
    const vp = v.victoryPoints as {total: number} | 'unknown';
    if (vp !== 'unknown' && vp !== undefined) {
      lines.push({template: 'VP now: ${0}', params: [value(vp.total)]});
    }
    return lines;
  }
  case 'unmodeled':
    return [{template: '${0} effects are not modeled', params: [value(v.count)]}];
  }
}
