import {CardName} from '@/common/cards/CardName';
import {CoachLLMContext, CoachModelReply} from '../../common/CoachChat';
import {contextCardNames} from './contextBuilder';
import {MAX_MESSAGE_LENGTH} from './instructions';

// Checks a model answer against the context it was given, before anything is shown to the player.
//
// The checks are mechanical, so a correct shape is not taken as correct facts: plans and cards must
// exist in the context, every number of the message must be a number of the context (no computed
// totals), and claims the analysis never makes (win chances, optimal moves) are refused.

export type ReplyProblem = {
  code: 'shape' | 'unknown-plan' | 'unknown-card' | 'card-not-in-context' | 'number-not-in-context' | 'forbidden-claim' | 'too-long' | 'empty',
  detail: string,
};

export type ValidatedReply = {ok: true, reply: CoachModelReply} | {ok: false, problems: ReadonlyArray<ReplyProblem>, reply?: CoachModelReply};

/** Numbers that need no source: counts of plans, cards and production phases the coach talks about. */
export const FREE_NUMBERS = [0, 1, 2, 3];

const FORBIDDEN = [
  /勝率|必勝|最適解|最善手|確実に勝/,
  /\bwin(ning)? (rate|chance|probability)\b/i,
  /\boptimal\b/i,
  /\bguaranteed\b/i,
];

const NEGATION = /ません|かねます|できない|ない(?:ため|ので|です|。|、)|なく|不明|\b(cannot|can't|not|no|unknown)\b/i;

/** Card names to look for in free text: skip short single words that are also ordinary words (Mine, Moss…). */
const SEARCHABLE_CARD_NAMES: ReadonlyArray<string> = Object.values(CardName)
  .filter((name) => !name.includes(':') && (name.includes(' ') || name.length >= 6));

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** Full-width digits and minus signs to ASCII. */
function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0)).replace(/[−－]/g, '-');
}

/** Every number in a value (numbers, and digits inside strings). */
export function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === 'number') {
    out.add(value);
    out.add(Math.abs(value));
  } else if (typeof value === 'string') {
    for (const match of normalizeDigits(value).matchAll(/\d+(?:\.\d+)?/g)) {
      out.add(Number(match[0]));
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumbers(v, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
}

/** Numbers written in the message (plan aliases like P2 and card names are not numbers). */
export function numbersIn(message: string, cardNames: Iterable<string>): Array<number> {
  let text = normalizeDigits(message).replace(/\bP\d+\b/g, ' ');
  for (const name of cardNames) {
    text = text.split(name).join(' ');
  }
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}

/** Catalog card names written in `text` that are not in `known` (names of `known` are removed first). */
export function foreignCardNames(text: string, known: ReadonlySet<string>): Array<string> {
  // Names of the context are removed first, so that "Power Plant:SP" does not read as the card "Power Plant".
  let rest = text;
  for (const name of [...known].sort((a, b) => b.length - a.length)) {
    rest = rest.split(name).join(' ');
  }
  return SEARCHABLE_CARD_NAMES.filter((name) => !known.has(name) &&
    new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z:]|$)`).test(rest));
}

/** Win chances, optimal moves, guarantees claimed in `text` (a sentence that declines them is fine). */
export function forbiddenClaims(text: string): Array<string> {
  const found: Array<string> = [];
  for (const sentence of text.split(/(?<=[。．.!?！？\n])/)) {
    if (NEGATION.test(sentence)) {
      continue;
    }
    for (const pattern of FORBIDDEN) {
      const match = sentence.match(pattern);
      if (match !== null) {
        found.push(match[0]);
      }
    }
  }
  return found;
}

export function validateReply(raw: unknown, context: CoachLLMContext): ValidatedReply {
  if (raw === null || typeof raw !== 'object') {
    return {ok: false, problems: [{code: 'shape', detail: 'not an object'}]};
  }
  const r = raw as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(',');
  if (typeof r.message !== 'string' || !isStringArray(r.planIds) || !isStringArray(r.cards) || !isStringArray(r.followUpQuestions) ||
      keys !== 'cards,followUpQuestions,message,planIds') {
    return {ok: false, problems: [{code: 'shape', detail: `fields: ${keys}`}]};
  }
  const reply: CoachModelReply = {message: r.message, planIds: r.planIds, cards: r.cards, followUpQuestions: r.followUpQuestions.slice(0, 3)};
  const problems: Array<ReplyProblem> = [];

  if (reply.message.trim() === '') {
    problems.push({code: 'empty', detail: 'empty message'});
  }
  if (reply.message.length > MAX_MESSAGE_LENGTH * 1.5) {
    problems.push({code: 'too-long', detail: `${reply.message.length} characters`});
  }
  const plans = new Set(context.analysis.plans.map((p) => p.id));
  for (const id of reply.planIds) {
    if (!plans.has(id)) {
      problems.push({code: 'unknown-plan', detail: id});
    }
  }
  for (const id of reply.message.match(/\bP\d+\b/g) ?? []) {
    if (!plans.has(id)) {
      problems.push({code: 'unknown-plan', detail: `${id} in message`});
    }
  }
  const known = contextCardNames(context);
  for (const card of reply.cards) {
    if (!known.has(card)) {
      problems.push({code: 'unknown-card', detail: card});
    }
  }
  for (const name of foreignCardNames(reply.message, known)) {
    problems.push({code: 'card-not-in-context', detail: name});
  }
  const allowed = new Set<number>(FREE_NUMBERS);
  collectNumbers(context, allowed);
  for (const n of numbersIn(reply.message, known)) {
    if (!allowed.has(n)) {
      problems.push({code: 'number-not-in-context', detail: String(n)});
    }
  }
  for (const claim of forbiddenClaims(reply.message)) {
    problems.push({code: 'forbidden-claim', detail: claim});
  }
  return problems.length === 0 ? {ok: true, reply} : {ok: false, problems, reply};
}
