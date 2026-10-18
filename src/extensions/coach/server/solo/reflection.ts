import {CoachLabel} from '../../common/CoachChoiceList';
import {CoachFindingsV1, CoachFindingV1, FindingEvidence} from '../../common/CoachFindings';
import {COACH_REFLECTION_REQUEST_SCHEMA, COACH_REFLECTION_SCHEMA, CoachReflectionRequest, CoachReflectionV1} from '../../common/CoachReflection';
import {aboutLabel, hintLines, nextQuestion, optionsAt, QuestionContext, ruleLines} from './questioner';

// Reflection on one finding (P3-SOLO-3). Questions come from the CoachQuestioner, which only knows what
// the player did; the evidence of the Strategist (the evaluator) is shown at Gate C, and the comparison
// with the alternative only when the player asks for it (`explain`). Deterministic, read-only.

const label = (template: string, ...params: Array<{text: string, card?: boolean}>): CoachLabel => ({template, params});
const card = (name: unknown) => ({text: String(name ?? ''), card: true});
const value = (n: unknown) => ({text: String(n)});

/** What the questioner may know: the decision, without the alternative or the difference. */
export function questionContext(finding: CoachFindingV1): QuestionContext {
  return {kind: finding.kind, generation: finding.decision.generation, cards: finding.actual.summary.params.map((p) => p.text)};
}

const PARAMETER_NAMES: Readonly<Record<string, string>> = {temperature: 'Temperature', oxygen: 'Oxygen', oceans: 'Oceans'};

/** Facts of the evidence, for Gate C and the explanation (values only, no verdict). */
function evidenceLines(finding: CoachFindingV1): Array<CoachLabel> {
  const lines: Array<CoachLabel> = [];
  const [first] = finding.actual.summary.params.map((p) => p.text);
  const of = (kind: FindingEvidence['kind']) => finding.evidence.filter((e) => e.kind === kind).map((e) => e.value as Record<string, unknown>);
  switch (finding.kind) {
  case 'play-order-discount':
    for (const o of of('offered')) {
      lines.push(label('${0} was playable when you played ${1}', card(o.card), card(first)));
    }
    for (const d of of('discount')) {
      lines.push(label('${0} lowers the cost of ${1} from ${2} to ${3} M€', card(d.discountCard), card(d.target), value(d.costBefore), value(d.costAfter)));
    }
    break;
  case 'unplayable-purchase':
    for (const r of of('requirement')) {
      const name = PARAMETER_NAMES[String(r.kind)];
      if (name !== undefined) {
        lines.push(label(r.comparator === '<=' ? 'Requirement of ${0}: ${1} at most ${2}' : 'Requirement of ${0}: ${1} at least ${2}', card(r.card), card(name), value(r.target)));
        lines.push(label('When you bought it: ${0} ${1}', card(name), value(r.current)));
      }
    }
    break;
  case 'production-payback':
    for (const c of of('cost')) {
      lines.push(label('${0} cost ${1} M€', card(c.card), value(c.cost)));
    }
    for (const f of of('forecast')) {
      const change = (f.productionChange as Record<string, number> | undefined)?.megacredits ?? 0;
      lines.push(label('${0} raises your M€ production by ${1}', card(f.card), value(change)));
      lines.push(label('Production phases left when you played it: ${0}', value(f.productionPhasesLeft)));
    }
    break;
  }
  return lines;
}

function explanationLines(finding: CoachFindingV1): Array<CoachLabel> {
  const difference = finding.difference?.megacredits;
  const lines: Array<CoachLabel> = [label('What you did:'), finding.actual.summary, label('Alternative from this point of view:'), finding.alternative.summary];
  if (difference !== undefined) {
    switch (finding.kind) {
    case 'play-order-discount':
      lines.push(label('The alternative costs ${0} M€ less in total (${1} instead of ${2})', value(difference), value(finding.alternative.megacredits), value(finding.actual.megacredits)));
      break;
    case 'unplayable-purchase':
      lines.push(label('${0} M€ spent on a card that could not be played', value(difference)));
      break;
    case 'production-payback':
      lines.push(label('${0} M€ of its cost does not come back before the game ends', value(difference)));
      break;
    }
  }
  lines.push(...evidenceLines(finding));
  lines.push(label('Only this point of view is compared; other effects of the cards are not weighed.'));
  return lines;
}

/** Parses and checks a reflection request; returns an error message for anything unexpected. */
export function parseReflectionRequest(body: string): CoachReflectionRequest | string {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return 'body is not JSON';
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'body is not an object';
  }
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !['schemaVersion', 'findingId', 'answers', 'view'].includes(k))) {
    return 'unexpected fields';
  }
  if (r.schemaVersion !== COACH_REFLECTION_REQUEST_SCHEMA) {
    return 'schemaVersion';
  }
  if (typeof r.findingId !== 'string' || !/^[0-9a-f]{16}$/.test(r.findingId)) {
    return 'findingId';
  }
  if (!Array.isArray(r.answers) || r.answers.length > 3 || !r.answers.every((a) => typeof a === 'string' && /^[a-z]\.[a-z0-9-]{1,20}$/.test(a))) {
    return 'answers';
  }
  if (r.view !== 'question' && r.view !== 'hint' && r.view !== 'rules' && r.view !== 'explain') {
    return 'view';
  }
  return {schemaVersion: COACH_REFLECTION_REQUEST_SCHEMA, findingId: r.findingId, answers: r.answers as Array<string>, view: r.view};
}

/** The reflection step for the request, or an error message when the answers do not fit the questions. */
export function reflect(findings: CoachFindingsV1, request: CoachReflectionRequest): CoachReflectionV1 | string {
  const finding = findings.findings.find((f) => f.id === request.findingId && f.intervention);
  if (finding === undefined) {
    return {schemaVersion: COACH_REFLECTION_SCHEMA, findingId: request.findingId, status: 'gone', view: request.view};
  }
  const context = questionContext(finding);
  for (let i = 0; i < request.answers.length; i++) {
    if (!optionsAt(context, request.answers.slice(0, i)).includes(request.answers[i])) {
      return 'answers do not fit the questions';
    }
  }
  const base = {schemaVersion: COACH_REFLECTION_SCHEMA, findingId: finding.id, status: 'ok', kind: finding.kind, about: aboutLabel(context), view: request.view} as const;
  switch (request.view) {
  case 'hint':
    return {...base, lines: hintLines(context)};
  case 'rules':
    return {...base, lines: ruleLines(context, findings.solo?.lastGeneration ?? 14)};
  case 'explain':
    return {...base, lines: explanationLines(finding)};
  case 'question': {
    const next = nextQuestion(context, request.answers);
    return {
      ...base, gate: next.gate, question: next.question, options: next.options,
      // Gate C asks the player to look again at the evidence.
      ...(next.gate === 'C' ? {lines: evidenceLines(finding)} : {}),
    };
  }
  }
}
