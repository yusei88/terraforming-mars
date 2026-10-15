import {CoachFact, CoachPoint, FactSupport} from '../../common/CoachCounsel';
import {CoachLabel} from '../../common/CoachChoiceList';
import {blockerLine, linkLine, questionLine, signed, DisplayLine} from '../../common/coachText';
import {ChoiceFacts} from './facts';

// Coaching made from templates only: strengths, cautions and outlook that follow from the facts, and one
// question. Used when no model may be used and when a model answer is refused. It never ranks options
// and never says "best"; when the facts show no strength it says so instead of making one up.

export type Coaching = {strengths: Array<CoachPoint>, risks: Array<CoachPoint>, outlook: Array<CoachPoint>, question?: CoachPoint};

const RESOURCE_NAMES: Readonly<Record<string, string>> = {
  megacredits: 'Megacredits', steel: 'Steel', titanium: 'Titanium', plants: 'Plants', energy: 'Energy', heat: 'Heat',
};

function worst(facts: ReadonlyArray<CoachFact>): FactSupport {
  if (facts.some((f) => f.support === 'unknown')) {
    return 'unknown';
  }
  return facts.some((f) => f.support === 'conditional') ? 'conditional' : 'verified';
}

function point(about: 'A' | 'B', template: CoachLabel | DisplayLine, facts: ReadonlyArray<CoachFact>): CoachPoint {
  return {about, template: {template: template.template, params: template.params}, evidenceIds: facts.map((f) => f.id), support: worst(facts)};
}

const text = (template: string, ...params: Array<{text: string, card?: boolean}>): CoachLabel => ({template, params});
const value = (n: number | string) => ({text: String(n)});
const card = (name: string) => ({text: name, card: true});

function coachOne(about: 'A' | 'B', c: ChoiceFacts, out: Coaching, resources: CoachFact) {
  const kind = c.entry.option.kind;
  const name = c.entry.cardName;

  // Relations to other cards (positive ones are strengths, conflicts are cautions).
  for (const {edge, fact} of c.links) {
    (edge.kind === 'CONFLICTS_WITH' ? out.risks : out.strengths).push(point(about, linkLine(edge), [fact]));
  }

  // Forecast of the card alone, or of the plan.
  const forecast = c.forecast;
  const plan = c.forecastPlan?.forecast;
  if (forecast !== undefined && plan !== undefined) {
    const last = plan.deltas[plan.deltas.length - 1];
    if (last !== undefined) {
      for (const [resource, amount] of Object.entries(last.production)) {
        if (amount !== 0) {
          (amount > 0 ? out.strengths : out.risks).push(point(about, text('Production of ${0}: ${1}', card(RESOURCE_NAMES[resource] ?? resource), value(signed(amount))), [forecast]));
        }
      }
      if (last.terraformRating > 0) {
        out.strengths.push(point(about, text('Terraform rating: ${0}', value(signed(last.terraformRating))), [forecast]));
      }
    }
    if (plan.victoryPoints !== 'unknown' && plan.victoryPoints.total > 0) {
      out.strengths.push(point(about, text('VP now: ${0}', value(plan.victoryPoints.total)), [forecast]));
    }
    if (!plan.complete || plan.megacredits === 'unknown') {
      out.risks.push(point(about, text('Some effects are not modeled: totals are not shown'), [c.unmodeled ?? forecast]));
    } else {
      (plan.megacredits.recovered ? out.strengths : out.risks).push(point(about, text(plan.megacredits.recovered ? 'Paid back within this horizon' : 'Not paid back within this horizon'), [forecast]));
    }
    out.outlook.push(point(about, plan.productionsLeft === 'unknown' ?
      text('The end of the game is not known in a game with several players') :
      text('Production phases left in the game: ${0}', value(plan.productionsLeft)), [forecast]));
  }

  // Plans: what is playable now and what still blocks the rest.
  if (kind === 'strategy-plan' && c.plans[0] !== undefined) {
    const {plan: p, fact} = c.plans[0];
    const now = p.cards.filter((x) => x.availability === 'legal-now');
    if (p.cards.length > 1) {
      out.risks.push(point(about, now.length > 0 ?
        text('Only ${0} can be played now; the rest of the plan comes later', card(now[0].name)) :
        text('No card of this plan can be played now'), [fact]));
    }
    c.blockers.forEach((b, i) => out.risks.push(point(about, blockerLine({...p.blockers[i]}), [b])));
  } else if (kind === 'project-card' && c.plans.length > 0 && name !== undefined) {
    out.outlook.push(point(about, text('${0} is the first card of a longer plan (see Future)', card(name)), c.plans.map((x) => x.fact)));
  }

  // Cost and what is left.
  if (c.cost !== undefined) {
    const v = c.cost.value as {cost: number, megacreditsAfterPayingInMegacredits: number};
    out.outlook.push(point(about, text('Paying ${0} M€ in M€ leaves ${1} M€', value(v.cost), value(v.megacreditsAfterPayingInMegacredits)), [c.cost, resources]));
  }
  if (c.notInAnalysis) {
    out.risks.push(point(about, text('The analysis found no relation with your other cards (a missing relation does not mean there is none)'), c.cost === undefined ? [resources] : [c.cost]));
  }
  if (kind === 'game-option' || kind === 'standard-project') {
    out.risks.push(point(about, text('This choice is not analysed in numbers'), c.option !== undefined ? [c.option] : c.cost !== undefined ? [c.cost] : [resources]));
  }
}

/** Template coaching of the selected choice (A) and, when given, the compared one (B). */
export function templateCoaching(a: ChoiceFacts, b: ChoiceFacts | undefined, resources: CoachFact): Coaching {
  const out: Coaching = {strengths: [], risks: [], outlook: []};
  coachOne('A', a, out, resources);
  if (b !== undefined) {
    coachOne('B', b, out, resources);
  }
  if (!out.strengths.some((p) => p.about === 'A')) {
    out.strengths.unshift(point('A', text('The facts show no clear strength of this choice'), [a.cost ?? a.option ?? a.plans[0]?.fact ?? resources]));
  }
  const evidence = [a.cost ?? a.option ?? a.plans[0]?.fact ?? resources];
  if (b !== undefined && a.entry.cardName !== undefined && b.entry.cardName !== undefined) {
    out.question = point('A', text('What does ${0} give you that ${1} does not, and what does it cost you?', card(a.entry.cardName), card(b.entry.cardName)), evidence);
  } else {
    const planQuestion = (a.forecastPlan ?? a.plans[0]?.plan)?.question;
    const line = planQuestion === undefined ? undefined : questionLine(planQuestion);
    out.question = line !== undefined ?
      point('A', line, a.forecast !== undefined ? [a.forecast] : evidence) :
      point('A', text('What do you want to have done by the end of this generation, and how does this choice move you towards it?'), evidence);
  }
  return out;
}
