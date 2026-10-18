import * as responses from '@/server/server/responses';
import {Handler} from '@/server/routes/Handler';
import {Context} from '@/server/routes/IHandler';
import {Request} from '@/server/Request';
import {Response} from '@/server/Response';
import {RouteError} from '@/server/routes/RouteError';
import {IPlayer} from '@/server/IPlayer';
import {projectCoachState} from './projectCoachState';
import {getCatalogJson, catalogVersion} from './cardCatalog';
import {getCoachTracer} from './coachTrace';
import {cachedAnalysis} from './analysis/engine';
import {EVENT_POSITIONS, EventPosition} from '../common/CoachTrace';
import {readBody} from '@/server/routes/readBody';
import {choiceListFor, counsel, counselLimiter, CounselLimiter, MAX_COUNSEL_BODY_BYTES, parseCounselRequest} from './counsel/counselService';
import {aiSettings} from './counsel/aiConfig';
import {buildTimeline} from './solo/timeline';
import {buildFindings} from './solo/evaluator';
import {parseReflectionRequest, reflect} from './solo/reflection';

export const COACH_PATHS = {
  STATE: 'api/coach/state',
  CATALOG: 'api/coach/catalog',
  DECISIONS: 'api/coach/decisions',
  ANALYSIS: 'api/coach/analysis',
  OPTIONS: 'api/coach/options',
  COUNSEL: 'api/coach/counsel',
  TIMELINE: 'api/coach/timeline',
  FINDINGS: 'api/coach/findings',
  REFLECTION: 'api/coach/reflection',
} as const;

/**
 * Base of the coach routes that act for one player.
 *
 * Same access rule as `api/player`: the secret player id in `id`, plus the Discord user when the game
 * is bound to one. Spectator ids and unknown ids are refused.
 */
abstract class CoachPlayerHandler extends Handler {
  protected async player(ctx: Context): Promise<IPlayer> {
    const playerId = ctx.urlParams.playerId('id');
    const game = await ctx.gameLoader.getGame(playerId);
    if (game === undefined) {
      throw RouteError.notFound();
    }
    const player = game.players.find((p) => p.id === playerId);
    if (player === undefined) {
      throw RouteError.notFound();
    }
    if (!this.isUser(player.user, ctx)) {
      throw RouteError.forbidden();
    }
    return player;
  }
}

function noStore(res: Response) {
  // The answer contains the player's hand: never keep it in shared caches.
  res.setHeader('Cache-Control', 'no-store');
}

/** `GET api/coach/state?id=<playerId>`: the CoachStateV1 snapshot of that player. Read-only. */
export class ApiCoachState extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachState();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    let state;
    try {
      state = projectCoachState(player);
    } catch (error) {
      // A coach failure must stay a coach failure: the game itself is untouched.
      console.error('Coach state failed', error);
      throw RouteError.internalServerError('coach state unavailable');
    }
    noStore(res);
    responses.writeJson(res, ctx, state);
  }
}

/**
 * `GET api/coach/analysis?id=<playerId>[&horizon=0..3]`: CoachAnalysisV1 of that player (horizon 3 by
 * default). Read-only; a failure of the analysis is answered with 500 and never touches the game.
 */
export class ApiCoachAnalysis extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachAnalysis();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    const horizonParam = ctx.url.searchParams.get('horizon') ?? '3';
    if (!/^[0-3]$/.test(horizonParam)) {
      throw RouteError.badRequest('horizon must be 0, 1, 2 or 3');
    }
    let analysis;
    try {
      analysis = cachedAnalysis(projectCoachState(player), Number(horizonParam), player.id);
    } catch (error) {
      console.error('Coach analysis failed', error);
      throw RouteError.internalServerError('coach analysis unavailable');
    }
    noStore(res);
    // A copy: the response writer may add fields, and the cached result must stay as it was.
    responses.writeJson(res, ctx, {...analysis});
  }
}

/** `GET api/coach/catalog`: static card data of this build. Public, like the /cards page. */
export class ApiCoachCatalog extends Handler {
  public static readonly INSTANCE = new ApiCoachCatalog();
  private constructor() {
    super();
  }

  public override get(req: Request, res: Response, _ctx: Context): Promise<void> {
    const etag = `"${catalogVersion()}"`;
    if (req.headers['if-none-match'] === etag) {
      responses.notModified(res);
      return Promise.resolve();
    }
    const body = getCatalogJson();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('ETag', etag);
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
    return Promise.resolve();
  }
}

/**
 * `GET api/coach/decisions?id=<playerId>`: the player's own trace events (each with its `series`), the
 * trust in the history (`history`) and the trace storage health. Variants:
 *
 * - `&seq=<n>&position=before|after|from|to|observed`: the snapshot of one of the player's events at its
 *   place in history (CoachHistorySnapshot).
 * - `&fingerprint=<sha256>`: the first snapshot with this content (Phase 1; does not say when).
 *
 * Other players' events and snapshots are never returned. Reading never writes to the history.
 */
export class ApiCoachDecisions extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachDecisions();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    const tracer = getCoachTracer();
    noStore(res);
    const params = ctx.url.searchParams;
    const fingerprint = params.get('fingerprint');
    if (fingerprint !== null) {
      if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
        throw RouteError.badRequest('invalid fingerprint');
      }
      const state = tracer?.stateOf(player.game.id, player.color, fingerprint);
      if (state === undefined) {
        throw RouteError.notFound();
      }
      responses.writeJson(res, ctx, state);
      return;
    }
    const seqParam = params.get('seq');
    if (seqParam !== null) {
      const position = params.get('position') ?? '';
      if (!/^[1-9][0-9]{0,8}$/.test(seqParam) || !(EVENT_POSITIONS as ReadonlyArray<string>).includes(position)) {
        throw RouteError.badRequest('invalid seq or position');
      }
      const snapshot = tracer?.historySnapshot(player.game.id, player.color, Number(seqParam), position as EventPosition);
      if (snapshot === undefined) {
        throw RouteError.notFound();
      }
      responses.writeJson(res, ctx, snapshot);
      return;
    }
    if (tracer === undefined) {
      responses.writeJson(res, ctx, {tracing: false, history: {status: 'disabled', reason: 'COACH_TRACE_DIR is not set'}, events: []});
      return;
    }
    let history;
    try {
      const assessment = tracer.assess(player, projectCoachState(player));
      history = {status: assessment.status, reason: assessment.reason, lastConfirmedSeq: assessment.lastConfirmed?.seq};
    } catch (error) {
      console.error('Coach history check failed', error);
      history = {status: 'uncertain', reason: 'the current state could not be read'};
    }
    const {events, error} = tracer.eventsOf(player.game.id, player.color);
    const body: Record<string, unknown> = {tracing: true, history, health: tracer.health(), events};
    if (error !== undefined) {
      body.historyReadError = error;
    }
    responses.writeJson(res, ctx, body);
  }
}

/**
 * `GET api/coach/options?id=<playerId>`: what the player can choose to have coached now
 * (CoachChoiceListV1). Read-only.
 */
export class ApiCoachOptions extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachOptions();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    let list;
    try {
      list = choiceListFor(player).list;
    } catch (error) {
      console.error('Coach options failed', error);
      throw RouteError.internalServerError('coach options unavailable');
    }
    noStore(res);
    responses.writeJson(res, ctx, {...list});
  }
}

/** True unless the browser says the request comes from another site (CSRF). */
export function isSameOrigin(req: Request): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') {
    return site === 'same-origin' || site === 'none';
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * `POST api/coach/counsel?id=<playerId>`: facts and coaching about one option of the current position
 * (CoachCounselV1). JSON body of at most 2 KB, same origin only, one review at a time per player and a
 * limit per minute. Answers 409 when the position or the option is no longer current. Never changes
 * the game; a failing model falls back to template coaching.
 */
export class ApiCoachCounsel extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachCounsel();
  private constructor(private readonly limiter: CounselLimiter = counselLimiter) {
    super();
  }

  public override async post(req: Request, res: Response, ctx: Context): Promise<void> {
    if (!isSameOrigin(req)) {
      throw RouteError.forbidden('cross-site request');
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw RouteError.badRequest('Content-Type must be application/json');
    }
    const player = await this.player(ctx);
    const request = parseCounselRequest(await readBody(req, MAX_COUNSEL_BODY_BYTES));
    if (typeof request === 'string') {
      throw RouteError.badRequest(request);
    }
    const settings = aiSettings();
    const key = CounselLimiter.key(player.id);
    const review = request.mode === 'review';
    if (review) {
      const slot = this.limiter.begin(key, settings.perMinute, Date.now());
      if (slot !== 'ok') {
        throw RouteError.tooManyRequests(slot === 'busy' ? 'a review is already running' : 'too many reviews');
      }
    }
    // The model call is bounded by COACH_AI_TIMEOUT_MS; a closed page does not cancel it (the result is dropped).
    // The position is checked again on the game the GameLoader holds then (an undo replaces the Game object).
    const playerId = player.id;
    const reload = async () => (await ctx.gameLoader.getGame(playerId))?.players.find((p) => p.id === playerId);
    let outcome;
    try {
      outcome = await counsel(player, request, {reload, settings, limiter: this.limiter});
    } catch (error) {
      console.error('Coach counsel failed', error instanceof Error ? error.name : 'error');
      throw RouteError.internalServerError('coach counsel unavailable');
    } finally {
      if (review) {
        this.limiter.end(key);
      }
    }
    noStore(res);
    if (outcome.status === 400) {
      throw RouteError.badRequest(outcome.body.error);
    }
    res.statusCode = outcome.status;
    responses.writeJson(res, ctx, {...outcome.body});
  }
}

/**
 * `GET api/coach/timeline?id=<playerId>`: the player's decisions in a solo game as meaningful events
 * (CoachTimelineV1, P3-SOLO-1). Read-only. `status` says when there is no history to show (not a solo
 * game, history off because COACH_TRACE_DIR is not set, history unreadable): never an empty success.
 */
export class ApiCoachTimeline extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachTimeline();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    let timeline;
    try {
      const state = projectCoachState(player);
      const tracer = getCoachTracer();
      timeline = buildTimeline({
        tracer, gameId: player.game.id, color: player.color, state,
        history: () => tracer?.assess(player, state).status ?? 'disabled',
      });
    } catch (error) {
      console.error('Coach timeline failed', error);
      throw RouteError.internalServerError('coach timeline unavailable');
    }
    noStore(res);
    responses.writeJson(res, ctx, timeline);
  }
}

/**
 * `GET api/coach/findings?id=<playerId>`: decisions of the player's solo game that could have been better
 * from one point of view, with evidence (CoachFindingsV1, P3-SOLO-2). Read-only and deterministic.
 */
export class ApiCoachFindings extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachFindings();
  private constructor() {
    super();
  }

  public override async get(_req: Request, res: Response, ctx: Context): Promise<void> {
    const player = await this.player(ctx);
    let findings;
    try {
      const state = projectCoachState(player);
      const tracer = getCoachTracer();
      findings = buildFindings({
        tracer, gameId: player.game.id, color: player.color, state,
        history: () => tracer?.assess(player, state).status ?? 'disabled',
      }, {upcoming: ctx.url.searchParams.get('upcoming') === '1'});
    } catch (error) {
      console.error('Coach findings failed', error);
      throw RouteError.internalServerError('coach findings unavailable');
    }
    noStore(res);
    responses.writeJson(res, ctx, findings);
  }
}

/**
 * `POST api/coach/reflection?id=<playerId>`: the next step of a reflection on one finding of the player's
 * solo game (CoachReflectionV1, P3-SOLO-3): a question (Gate A, B, C), a hint, the rules, or, when the
 * player asks, the comparison with the alternative. Same origin, JSON, 1 KB. Read-only, deterministic.
 */
export class ApiCoachReflection extends CoachPlayerHandler {
  public static readonly INSTANCE = new ApiCoachReflection();
  private constructor() {
    super();
  }

  public override async post(req: Request, res: Response, ctx: Context): Promise<void> {
    if (!isSameOrigin(req)) {
      throw RouteError.forbidden('cross-site request');
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw RouteError.badRequest('Content-Type must be application/json');
    }
    const player = await this.player(ctx);
    const request = parseReflectionRequest(await readBody(req, 1024));
    if (typeof request === 'string') {
      throw RouteError.badRequest(request);
    }
    let step;
    try {
      const state = projectCoachState(player);
      const tracer = getCoachTracer();
      step = reflect(buildFindings({tracer, gameId: player.game.id, color: player.color, state, history: () => 'valid'}), request);
    } catch (error) {
      console.error('Coach reflection failed', error instanceof Error ? error.name : 'error');
      throw RouteError.internalServerError('coach reflection unavailable');
    }
    if (typeof step === 'string') {
      throw RouteError.badRequest(step);
    }
    noStore(res);
    responses.writeJson(res, ctx, step);
  }
}
