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
import {EVENT_POSITIONS, EventPosition} from '../common/CoachTrace';

export const COACH_PATHS = {
  STATE: 'api/coach/state',
  CATALOG: 'api/coach/catalog',
  DECISIONS: 'api/coach/decisions',
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
