import {createHash} from 'crypto';
import {IPlayer} from '@/server/IPlayer';
import {projectCoachState} from '../projectCoachState';
import {cachedAnalysis} from '../analysis/engine';
import {buildChoiceList, BuiltChoiceList} from '../choices/choicePresenter';
import {choiceFacts, FactCollector, gameFacts} from './facts';
import {templateCoaching} from './templateCoaching';
import {modelCounsel} from './counselModel';
import {aiProvider, aiSettings, AiSettings} from './aiConfig';
import {CoachLLMProvider} from '../chat/providers/LLMProvider';
import {COACH_COUNSEL_REQUEST_SCHEMA, COACH_COUNSEL_SCHEMA, CoachCounselRequest, CoachCounselV1} from '../../common/CoachCounsel';
import {CoachChoiceListV1} from '../../common/CoachChoiceList';

// Options and counsel for one player (P3-CD-1). Everything is rebuilt from the current game on every
// request, the client's ids are only looked up in that rebuilt list, and nothing is written to the game.

/** The options of the player now (GET api/coach/options). */
export function choiceListFor(player: IPlayer, settings: AiSettings = aiSettings()): BuiltChoiceList {
  const state = projectCoachState(player);
  const analysis = cachedAnalysis(state, 3, player.id);
  return buildChoiceList(player, state, analysis, player.id, settings.enabled);
}

export const MAX_COUNSEL_BODY_BYTES = 2048;

/** Parses and checks a counsel request; returns an error message for anything unexpected. */
export function parseCounselRequest(body: string): CoachCounselRequest | string {
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
  const allowed = ['schemaVersion', 'positionToken', 'choiceId', 'compareWithChoiceId', 'mode', 'language', 'aiConsent'];
  const extra = Object.keys(r).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    return 'unexpected fields';
  }
  if (r.schemaVersion !== COACH_COUNSEL_REQUEST_SCHEMA) {
    return 'schemaVersion';
  }
  if (typeof r.positionToken !== 'string' || !/^[0-9a-f]{32}$/.test(r.positionToken)) {
    return 'positionToken';
  }
  if (typeof r.choiceId !== 'string' || !/^[0-9a-f]{16}$/.test(r.choiceId)) {
    return 'choiceId';
  }
  const compare = r.compareWithChoiceId;
  if (compare !== undefined && compare !== null && (typeof compare !== 'string' || !/^[0-9a-f]{16}$/.test(compare) || compare === r.choiceId)) {
    return 'compareWithChoiceId';
  }
  if (r.mode !== 'facts' && r.mode !== 'review') {
    return 'mode';
  }
  if (typeof r.language !== 'string' || !/^[a-z]{2}$/.test(r.language)) {
    return 'language';
  }
  if (typeof r.aiConsent !== 'boolean') {
    return 'aiConsent';
  }
  return {
    schemaVersion: COACH_COUNSEL_REQUEST_SCHEMA, positionToken: r.positionToken, choiceId: r.choiceId,
    compareWithChoiceId: typeof compare === 'string' ? compare : null, mode: r.mode, language: r.language, aiConsent: r.aiConsent,
  };
}

/** Per-player limits of the counsel requests (in this process). */
export class CounselLimiter {
  private readonly inFlight = new Set<string>();
  private readonly recent = new Map<string, Array<number>>();
  public modelCalls = 0;

  public static key(playerId: string): string {
    return createHash('sha256').update(playerId).digest('hex').slice(0, 16);
  }

  /** Reserves a review for this player, or says why not ('busy' while another one runs, 'rate' when too many). */
  public begin(key: string, perMinute: number, now: number): 'ok' | 'busy' | 'rate' {
    if (this.inFlight.has(key)) {
      return 'busy';
    }
    const times = (this.recent.get(key) ?? []).filter((t) => now - t < 60000);
    if (times.length >= perMinute) {
      this.recent.set(key, times);
      return 'rate';
    }
    times.push(now);
    this.recent.set(key, times);
    this.inFlight.add(key);
    return 'ok';
  }

  public end(key: string): void {
    this.inFlight.delete(key);
  }
}

export const counselLimiter = new CounselLimiter();

export type CounselOutcome =
  {status: 200, body: CoachCounselV1} |
  {status: 409, body: {schemaVersion: typeof COACH_COUNSEL_SCHEMA, status: 'stale', positionToken: string}} |
  {status: 400, body: {error: string}};

export type CounselOptions = {
  /**
   * Loads the player from the current game again (through the GameLoader). Used to check the position
   * once the answer is made: an undo replaces the whole Game object, so the `player` the request started
   * with may no longer be the game that is played.
   */
  reload: () => Promise<IPlayer | undefined>,
  settings?: AiSettings,
  provider?: CoachLLMProvider,
  limiter?: CounselLimiter,
  abortSignal?: AbortSignal,
};

/** Facts and coaching for one option of the player's current position. */
export async function counsel(player: IPlayer, request: CoachCounselRequest, options: CounselOptions): Promise<CounselOutcome> {
  const settings = options.settings ?? aiSettings();
  const limiter = options.limiter ?? counselLimiter;
  const state = projectCoachState(player);
  const analysis = cachedAnalysis(state, 3, player.id);
  const built = buildChoiceList(player, state, analysis, player.id, settings.enabled);
  const list: CoachChoiceListV1 = built.list;
  const stale: CounselOutcome = {status: 409, body: {schemaVersion: COACH_COUNSEL_SCHEMA, status: 'stale', positionToken: list.positionToken}};
  if (request.positionToken !== list.positionToken) {
    return stale;
  }
  const a = built.entries.get(request.choiceId);
  const b = request.compareWithChoiceId === null || request.compareWithChoiceId === undefined ? undefined : built.entries.get(request.compareWithChoiceId);
  if (a === undefined || (request.compareWithChoiceId && b === undefined)) {
    return {status: 400, body: {error: 'unknown choice'}};
  }
  if (!a.option.selectableForCoaching || (b !== undefined && !b.option.selectableForCoaching)) {
    return {status: 400, body: {error: 'choice cannot be coached'}};
  }

  const collector = new FactCollector();
  const {resources} = gameFacts(collector, state);
  const factsA = choiceFacts(collector, 'A', a, state, analysis);
  const factsB = b === undefined ? undefined : choiceFacts(collector, 'B', b, state, analysis);
  const limitations = [...new Set([...a.option.limitations, ...(b?.option.limitations ?? [])])];
  const base: CoachCounselV1 = {
    schemaVersion: COACH_COUNSEL_SCHEMA, positionToken: list.positionToken, selectedChoiceId: a.option.id,
    ...(b === undefined ? {} : {compareWithChoiceId: b.option.id}),
    status: 'ready', source: 'none', facts: collector.facts, strengths: [], risks: [], outlook: [], limitations,
    ai: {state: settings.enabled ? (request.aiConsent ? 'used' : 'no-consent') : 'off'},
  };
  if (request.mode === 'facts') {
    return {status: 200, body: {...base, ai: {state: settings.enabled ? 'no-consent' : 'off'}}};
  }

  const template = templateCoaching(factsA, factsB, resources);
  let body: CoachCounselV1 = {...base, source: 'template', ...template};
  const provider = settings.enabled && request.aiConsent ? (options.provider ?? aiProvider(settings)) : undefined;
  if (provider !== undefined) {
    if (limiter.modelCalls >= settings.maxCalls) {
      body = {...body, status: 'fallback', ai: {state: 'failed', category: 'budget'}};
    } else {
      limiter.modelCalls++;
      const answer = await modelCounsel(provider, request.language, a, b, collector.facts, options.abortSignal);
      body = answer.ok ?
        {...body, source: 'model', ...answer.coaching, ai: {state: 'used', elapsedMs: answer.elapsedMs}} :
        {...body, status: 'fallback', ai: {state: 'failed', category: answer.category, elapsedMs: answer.elapsedMs}};
    }
  }

  // The game may have moved on (or been replaced by an undo) while the answer was made: load the current
  // game again and never present the answer as advice for another position.
  const current = await options.reload();
  const after = current === undefined ? undefined : projectCoachState(current);
  if (after === undefined || after.stateKey !== state.stateKey || after.advisoryFingerprint !== state.advisoryFingerprint) {
    return {status: 200, body: {...base, status: 'stale', source: 'none', facts: [], strengths: [], risks: [], outlook: [], question: undefined}};
  }
  return {status: 200, body};
}
