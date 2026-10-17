import {CoachFact, CoachPoint, FactSupport} from '../../common/CoachCounsel';
import {CoachLLMProvider, ProviderResult} from '../chat/providers/LLMProvider';
import {languageName} from '../chat/instructions';
import {collectNumbers, forbiddenClaims, foreignCardNames, FREE_NUMBERS} from '../chat/replyValidator';
import {ChoiceEntry} from '../choices/choicePresenter';
import {Coaching} from './templateCoaching';

// The review of a chosen option by a language model (P3-CD-1). The model receives the chosen option (and
// the compared one), the facts about them and nothing else, and must tie every point to facts by id.
// Each point is checked against the facts it names: ids must exist, numbers must be numbers of those
// facts, card names must be names of those facts or of the options, and a point about A (or B) may only
// rest on facts of A (or B) and shared game facts. Any failure discards the whole answer (the caller
// falls back to the template coaching).

export const COUNSEL_INSTRUCTIONS_VERSION = 'coach-counsel-instructions/1';

const MAX_POINTS = 3;
const MAX_TEXT = 320;

export function counselInstructions(language: string): string {
  return [
    'You are a strategy coach for the board game Terraforming Mars. The player has chosen an option (A) and asks you to review it before playing. They may also compare it with another option (B).',
    'The JSON input holds the options and numbered facts (F1, F2, …) from the game server: costs, resources, relations between cards, blockers, forecasts over the next production phases. It is everything you know.',
    '',
    'Rules:',
    '- Give the strengths, the cautions (weak points, missed opportunities, uncertainty) and the outlook of A (and of B when present), and one question that helps the player decide. Do not agree with the choice just because the player made it.',
    '- Every point must name in "evidence" the ids of the facts it rests on, and use only those facts. If the facts show no strength, give no strength: do not invent one.',
    '- Use only numbers that appear in the facts you cite. Do not add up, estimate or compute new numbers.',
    '- A "conditional" or "unknown" card is not playable now. If a forecast has complete=false or a value is "unknown", say it is not fully known; never present its numbers as a total.',
    '- Never say an option is the best, optimal or certain, and give no win chances. You cannot act in the game.',
    '- Write card names exactly as in the facts (in English, unchanged). Do not use field names such as complete or legal-now; say it in plain words.',
    `- Write in ${languageName(language)}. Each point is one short sentence (under ${MAX_TEXT} characters). At most ${MAX_POINTS} points per list. Plain text.`,
    '- "about" says whether a point is about A or B. A point about A may only cite facts whose "about" is A or "game"; a point about B, facts about B or "game". The question may cite any fact.',
  ].join('\n');
}

const POINT = {
  type: 'object',
  properties: {about: {type: 'string', enum: ['A', 'B']}, text: {type: 'string'}, evidence: {type: 'array', items: {type: 'string'}}},
  required: ['about', 'text', 'evidence'],
  additionalProperties: false,
} as const;

export const COUNSEL_SCHEMA = {
  type: 'object',
  properties: {
    strengths: {type: 'array', items: POINT},
    risks: {type: 'array', items: POINT},
    outlook: {type: 'array', items: POINT},
    question: {type: 'object', properties: {text: {type: 'string'}, evidence: {type: 'array', items: {type: 'string'}}}, required: ['text', 'evidence'], additionalProperties: false},
  },
  required: ['strengths', 'risks', 'outlook', 'question'],
  additionalProperties: false,
} as const;

/** What the model receives: the options and the facts, without any id of the game or the server. */
export function counselInput(a: ChoiceEntry, b: ChoiceEntry | undefined, facts: ReadonlyArray<CoachFact>): unknown {
  const option = (alias: 'A' | 'B', e: ChoiceEntry) => ({alias, kind: e.option.kind, text: e.text, cards: e.option.cardNames, eligibility: e.option.eligibility});
  return {
    options: b === undefined ? [option('A', a)] : [option('A', a), option('B', b)],
    facts: facts.map((f) => ({id: f.id, about: f.about, kind: f.kind, support: f.support, value: f.value})),
  };
}

export type CounselProblem = {code: 'shape' | 'unknown-evidence' | 'no-evidence' | 'evidence-of-other-option' | 'number-not-in-evidence' | 'card-not-in-evidence' | 'forbidden-claim' | 'too-long' | 'too-many' | 'empty' | 'wrong-about', detail: string};

type RawPoint = {about: string, text: string, evidence: Array<string>};

function isPoint(v: unknown): v is RawPoint {
  const p = v as RawPoint;
  return typeof p === 'object' && p !== null && typeof p.about === 'string' && typeof p.text === 'string' && Array.isArray(p.evidence) && p.evidence.every((e) => typeof e === 'string');
}

function worst(facts: ReadonlyArray<CoachFact>): FactSupport {
  if (facts.some((f) => f.support === 'unknown')) {
    return 'unknown';
  }
  return facts.some((f) => f.support === 'conditional') ? 'conditional' : 'verified';
}

function namesIn(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => namesIn(v, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((v) => namesIn(v, out));
  }
}

/** Checks a model answer point by point against the facts it cites. */
export function validateCounsel(raw: unknown, facts: ReadonlyArray<CoachFact>, a: ChoiceEntry, b: ChoiceEntry | undefined): {ok: true, coaching: Coaching} | {ok: false, problems: Array<CounselProblem>} {
  const r = raw as Record<string, unknown>;
  const lists = ['strengths', 'risks', 'outlook'] as const;
  if (r === null || typeof r !== 'object' || lists.some((k) => !Array.isArray(r[k]) || !(r[k] as Array<unknown>).every(isPoint)) ||
      typeof r.question !== 'object' || r.question === null || typeof (r.question as RawPoint).text !== 'string' || !Array.isArray((r.question as RawPoint).evidence)) {
    return {ok: false, problems: [{code: 'shape', detail: 'fields'}]};
  }
  const byId = new Map(facts.map((f) => [f.id, f]));
  const optionNames = new Set([...a.option.cardNames, ...(b?.option.cardNames ?? [])]);
  const problems: Array<CounselProblem> = [];

  /**
   * A point about A may cite facts of A and shared game facts; a point about B, facts of B and game
   * facts. The question may weigh both options, so it may cite any fact.
   */
  const check = (where: string, p: {about?: string, text: string, evidence: Array<string>}, anyOption = false): CoachPoint | undefined => {
    if (p.text.trim() === '') {
      problems.push({code: 'empty', detail: where});
    }
    if (p.text.length > MAX_TEXT * 1.5) {
      problems.push({code: 'too-long', detail: where});
    }
    if (p.about === 'B' && b === undefined) {
      problems.push({code: 'wrong-about', detail: where});
    }
    if (p.evidence.length === 0) {
      problems.push({code: 'no-evidence', detail: where});
    }
    const cited: Array<CoachFact> = [];
    for (const id of p.evidence) {
      const fact = byId.get(id);
      if (fact === undefined) {
        problems.push({code: 'unknown-evidence', detail: `${where}: ${id}`});
      } else if (!anyOption && fact.about !== 'game' && fact.about !== (p.about === 'B' ? 'B' : 'A')) {
        problems.push({code: 'evidence-of-other-option', detail: `${where}: ${id}`});
      } else {
        cited.push(fact);
      }
    }
    // Numbers and card names must come from the facts this point cites (not from anywhere in the input).
    const numbers = new Set<number>(FREE_NUMBERS);
    const names = new Set<string>(optionNames);
    for (const fact of cited) {
      collectNumbers(fact.value, numbers);
      namesIn(fact.value, names);
    }
    let rest = p.text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/\bF\d+\b/g, ' ');
    for (const name of [...names].sort((x, y) => y.length - x.length)) {
      rest = rest.split(name).join(' ');
    }
    for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const n = Number(m[0].replace(',', '.'));
      if (!numbers.has(n)) {
        problems.push({code: 'number-not-in-evidence', detail: `${where}: ${n}`});
      }
    }
    for (const name of foreignCardNames(p.text, names)) {
      problems.push({code: 'card-not-in-evidence', detail: `${where}: ${name}`});
    }
    for (const claim of forbiddenClaims(p.text)) {
      problems.push({code: 'forbidden-claim', detail: `${where}: ${claim}`});
    }
    return cited.length === 0 ? undefined : {about: p.about === 'B' ? 'B' : 'A', text: p.text, evidenceIds: cited.map((f) => f.id), support: worst(cited)};
  };

  const coaching: Coaching = {strengths: [], risks: [], outlook: []};
  for (const list of lists) {
    const items = r[list] as Array<RawPoint>;
    if (items.length > MAX_POINTS * (b === undefined ? 1 : 2)) {
      problems.push({code: 'too-many', detail: list});
    }
    items.forEach((p, i) => {
      const checked = check(`${list}[${i}]`, p);
      if (checked !== undefined) {
        coaching[list].push(checked);
      }
    });
  }
  const question = check('question', {...(r.question as RawPoint), about: 'A'}, true);
  if (question !== undefined) {
    coaching.question = question;
  }
  return problems.length === 0 ? {ok: true, coaching} : {ok: false, problems};
}

export type ModelCounsel = {ok: true, coaching: Coaching, elapsedMs: number} | {ok: false, category: string, elapsedMs: number, problems?: Array<CounselProblem>};

export async function modelCounsel(provider: CoachLLMProvider, language: string, a: ChoiceEntry, b: ChoiceEntry | undefined, facts: ReadonlyArray<CoachFact>, abortSignal?: AbortSignal): Promise<ModelCounsel> {
  const result: ProviderResult = await provider.generate({
    mode: 'explain', language, question: '', recentConversation: [], abortSignal,
    task: {instructions: counselInstructions(language), schemaName: 'coach_counsel', schema: COUNSEL_SCHEMA, input: counselInput(a, b, facts)},
  });
  if (!result.ok) {
    return {ok: false, category: result.category, elapsedMs: result.elapsedMs};
  }
  const validated = validateCounsel(result.structuredReply, facts, a, b);
  return validated.ok ?
    {ok: true, coaching: validated.coaching, elapsedMs: result.elapsedMs} :
    {ok: false, category: 'validation', elapsedMs: result.elapsedMs, problems: validated.problems};
}
