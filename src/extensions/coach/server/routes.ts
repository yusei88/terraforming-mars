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
 * `GET api/coach/decisions?id=<playerId>[&fingerprint=<hash>]`: the player's own trace events, or one
 * recorded snapshot of that player. Other players' events and snapshots are never returned.
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
    const fingerprint = ctx.url.searchParams.get('fingerprint');
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
    responses.writeJson(res, ctx, {
      tracing: tracer !== undefined,
      events: tracer?.eventsOf(player.game.id, player.color) ?? [],
    });
  }
}
