import {CandidatePlan, PlanCard, PlanForecast, PlanGoal, PlanQuestion, RequirementGap, SynergyEdge} from '../common/CoachAnalysis';

// What the coach panel shows, as fixed English templates (`${0}` …) and parameters. Every template is
// translated (src/extensions/coach/locales); card names are translated by the game's own card texts.
// Free-form English from the server (reasons, assumptions) is never shown.

/** A line to show: `template` is translated, then filled with `params` (card names translated too). */
export type DisplayLine = {template: string, params: ReadonlyArray<{text: string, card?: boolean}>};

const card = (name: string) => ({text: name, card: true});
const value = (n: number | string) => ({text: String(n)});

export function goalLabel(goal: PlanGoal): string {
  switch (goal) {
  case 'economy': return 'Economy';
  case 'unlock': return 'Unlock';
  case 'engine': return 'Engine';
  case 'scoring': return 'Scoring';
  case 'terraforming': return 'Terraforming';
  }
}

export function availabilityLabel(availability: PlanCard['availability']): string {
  switch (availability) {
  case 'legal-now': return 'Playable now';
  case 'conditional': return 'Later';
  case 'unknown': return 'Cannot check';
  }
}

/** One relation of a plan, from its structured fields. */
export function linkLine(edge: SynergyEdge): DisplayLine {
  switch (edge.kind) {
  case 'DISCOUNTS':
    return edge.alreadyApplied || edge.amount === undefined ?
      {template: '${0} already lowers the cost of ${1}', params: [card(edge.from), card(edge.to)]} :
      {template: '${0} makes ${1} cheaper by ${2} M€', params: [card(edge.from), card(edge.to), value(edge.amount)]};
  case 'UNLOCKS':
    return edge.completes ?
      {template: '${0} meets the requirement of ${1}', params: [card(edge.from), card(edge.to)]} :
      {template: '${0} brings ${1} closer to its requirement', params: [card(edge.from), card(edge.to)]};
  case 'PRODUCES_FOR':
    return {template: '${0} provides resources that ${1} can use', params: [card(edge.from), card(edge.to)]};
  case 'SCORING':
    return {template: '${0} adds ${2} VP to ${1}', params: [card(edge.from), card(edge.to), value(edge.amount ?? 0)]};
  case 'CONFLICTS_WITH':
    return edge.playFirst !== undefined ?
      {template: 'Play ${1} before ${0}', params: [card(edge.from), card(edge.playFirst)]} :
      {template: '${0} and ${1} compete for the same resource', params: [card(edge.from), card(edge.to)]};
  default:
    return {template: '${0} brings ${1} closer to its requirement', params: [card(edge.from), card(edge.to)]};
  }
}

/** What still blocks a card of a plan. */
export function blockerLine(blocker: RequirementGap & {card: string}): DisplayLine {
  if (blocker.status === 'unsupported') {
    return {template: '${0}: a condition cannot be checked', params: [card(blocker.card)]};
  }
  if (blocker.kind === 'cost' && typeof blocker.gap === 'number') {
    return {template: '${0}: ${1} M€ short', params: [card(blocker.card), value(blocker.gap)]};
  }
  if (blocker.kind === 'production') {
    return {template: '${0}: not enough production', params: [card(blocker.card)]};
  }
  return {template: '${0}: requirement not met yet', params: [card(blocker.card)]};
}

/** The question of a plan, from its key and parameters (the server text is English only). */
export function questionLine(question: PlanQuestion): DisplayLine | undefined {
  const p = question.params;
  switch (question.key) {
  case 'plan.unlock':
    return {template: 'Is it worth playing ${0} mainly to meet the requirement of ${1}, or is there another way to get there?', params: [card(p.from), card(p.to)]};
  case 'plan.engine':
    return {template: '${0} helps you pay for ${1}. How many more cards will profit from it before the game ends?', params: [card(p.from), card(p.to)]};
  case 'plan.scoring':
    return {template: 'How many points will ${0} be worth at the end, and what does it take to keep adding to them?', params: [card(p.to)]};
  case 'plan.terraforming':
    return {template: 'Raising a global parameter with ${0} also moves other requirements. Which of your cards does it help or block?', params: [card(p.card)]};
  case 'plan.economy':
    return {template: 'How many production phases are left for ${0} to pay back what it costs?', params: [card(p.card)]};
  default:
    return undefined;
  }
}

export function rowLabel(productionIndex: number): DisplayLine {
  return productionIndex === 0 ?
    {template: 'After playing', params: []} :
    {template: 'After production ${0}', params: [value(productionIndex)]};
}

/** Summary lines of a forecast: cost, payback (only when complete), VP now. */
export function forecastLines(forecast: PlanForecast): Array<DisplayLine> {
  const lines: Array<DisplayLine> = [];
  if (typeof forecast.upfront.play === 'number') {
    lines.push({template: 'Cost: ${0} M€', params: [value(forecast.upfront.play + forecast.upfront.purchase)]});
  }
  if (!forecast.complete || forecast.megacredits === 'unknown') {
    lines.push({template: 'Some effects are not modeled: totals are not shown', params: []});
  } else {
    lines.push({template: forecast.megacredits.recovered ? 'Paid back within this horizon' : 'Not paid back within this horizon', params: []});
  }
  if (forecast.victoryPoints !== 'unknown') {
    lines.push({template: 'VP now: ${0}', params: [value(forecast.victoryPoints.total)]});
  }
  return lines;
}

/** Signed number for the forecast table (+3, −2, 0). */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

/** True when the plan relies on assumptions (shown as a badge). */
export function conditional(plan: CandidatePlan): boolean {
  return plan.support.level !== 'verified';
}
