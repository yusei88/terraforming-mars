// Live check of the coach API against a running server (Phase 1 QA, see docs/coach/phase1-qa.md).
//
// Plays real games through the same HTTP endpoints the browser uses (POST /player/input) and, at every
// step, compares /api/coach/state with /api/player (the model the page renders), checks that reads do not
// change the game, that other players' secrets do not leak, and records latency.
//
//   npx tsx scripts/coach/liveCheck.ts --base http://localhost:8081 --out evidence.json p<id1> [p<id2> …]
//
// With --read-only it never answers (safe on a game someone is playing): it only reads and compares,
// every --interval milliseconds, --steps times.
//
// Player ids are secrets: the evidence file replaces them with placeholders.
import * as fs from 'fs';
import {CoachStateV1} from '../../src/extensions/coach/common/CoachState';
import {PlayerViewModel} from '../../src/common/models/PlayerModel';
import {answer} from './autopilot';

type Check = {name: string, ok: boolean, detail?: string};

const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
const base = option('--base', 'http://localhost:8081');
const out = option('--out', '');
const maxSteps = Number(option('--steps', '400'));
const undoAt = Number(option('--undo-at', '-1'));
const interval = Number(option('--interval', '3000'));
const readOnlyIndex = args.indexOf('--read-only');
const readOnly = readOnlyIndex >= 0;
if (readOnly) {
  args.splice(readOnlyIndex, 1);
}
const playerIds = args;

const checks: Array<Check> = [];
const fingerprints: Array<string> = [];
const latencies: Array<number> = [];
let decisions = 0;

function check(name: string, ok: boolean, detail?: string) {
  checks.push({name, ok, detail});
  if (!ok) {
    console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`);
  }
}

async function get<T>(path: string): Promise<{status: number, body: T, headers: Headers}> {
  const response = await fetch(base + path);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (error pages): keep the text.
  }
  return {status: response.status, body: body as T, headers: response.headers};
}

async function coachState(id: string): Promise<CoachStateV1> {
  const started = performance.now();
  const {status, body} = await get<CoachStateV1>(`/api/coach/state?id=${id}`);
  latencies.push(performance.now() - started);
  if (status !== 200) {
    throw new Error(`coach state ${status}`);
  }
  return body;
}

function compare(label: string, state: CoachStateV1, view: PlayerViewModel) {
  const me = view.thisPlayer;
  const same = (what: string, a: unknown, b: unknown) => check(`${label}: ${what} matches the page model`, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  same('generation', state.game.generation, view.game.generation);
  same('phase', state.game.phase, view.game.phase);
  same('gameAge', state.version.gameAge, view.game.gameAge);
  same('undoCount', state.version.undoCount, view.game.undoCount);
  same('temperature/oxygen/oceans', [state.game.temperature.value, state.game.oxygen.value, state.game.oceans.value], [view.game.temperature, view.game.oxygenLevel, view.game.oceans]);
  same('M€', state.me.resources.megacredits, me.megacredits);
  same('production', state.me.production, {
    megacredits: me.megacreditProduction, steel: me.steelProduction, titanium: me.titaniumProduction,
    plants: me.plantProduction, energy: me.energyProduction, heat: me.heatProduction});
  same('TR', state.me.terraformRating, me.terraformRating);
  same('hand', state.me.hand.map((c) => [c.name, c.calculatedCost]), view.cardsInHand.map((c) => [c.name, c.calculatedCost]));
  same('tableau', state.me.tableau.map((c) => [c.name, c.resources]), me.tableau.map((c) => [c.name, c.resources]));
  same('tiles', state.game.spaces.filter((s) => s.tile !== undefined).length, view.game.spaces.filter((s) => s.tileType !== undefined).length);
  same('opponents', state.opponents.map((o) => [o.color, o.terraformRating, o.cardsInHandCount]),
    view.players.filter((p) => p.color !== view.color).map((p) => [p.color, p.terraformRating, p.cardsInHandNbr]));
  const offered = view.waitingFor === undefined ? 'none' : view.waitingFor.type;
  same('question type', state.choices.status === 'awaiting-input' ? state.choices.root.inputType : 'none', offered);
}

async function main() {
  // S29 / S28: bad ids.
  check('missing id is refused', (await get('/api/coach/state')).status === 400);
  check('malformed id is refused', (await get('/api/coach/state?id=..%2F..%2Fetc')).status === 400);
  check('unknown player id is 404', (await get('/api/coach/state?id=p000000000000')).status === 404);
  const first = await get<PlayerViewModel>(`/api/player?id=${playerIds[0]}`);
  check('spectator id is refused', (await get(`/api/coach/state?id=${first.body.game.spectatorId}`)).status === 400);
  const catalog = await get<{cards: Array<{name: string}>}>('/api/coach/catalog');
  check('catalog is served', catalog.status === 200 && catalog.body.cards.length > 500);
  const catalogNames = new Set(catalog.body.cards.map((c) => c.name));

  const undone = new Set<number>();
  for (let step = 0; step < maxSteps; step++) {
    let acted = false;
    for (const [index, id] of playerIds.entries()) {
      const label = `step ${step} player ${index}`;
      const state = await coachState(id);
      const again = await coachState(id);
      fingerprints.push(state.fingerprint);
      check(`${label}: repeated reads give the same fingerprint`, state.fingerprint === again.fingerprint);
      const view = (await get<PlayerViewModel>(`/api/player?id=${id}`)).body;
      compare(label, state, view);
      const json = JSON.stringify(state);
      check(`${label}: no ids in the snapshot`, playerIds.every((p) => !json.includes(p)) && !json.includes(view.game.spectatorId));
      for (const card of [...state.me.hand, ...state.me.tableau]) {
        check(`${label}: ${card.name} is in the catalog`, catalogNames.has(card.name));
      }
      // S25: nothing of another player's hand shows up.
      for (const otherId of playerIds.filter((p) => p !== id)) {
        const other = (await get<PlayerViewModel>(`/api/player?id=${otherId}`)).body;
        const leaked = other.cardsInHand.map((c) => c.name).filter((name) => json.includes(`"${name}"`) && !state.me.hand.some((c) => c.name === name));
        check(`${label}: no secret card of another player`, leaked.length === 0, leaked.join(', '));
        const theirs = state.opponents.find((o) => o.color === other.color);
        const vpShown = state.game.gameOver || state.game.options.showOtherPlayersVP;
        check(`${label}: other player's VP ${vpShown ? 'known' : 'hidden'}`, theirs?.victoryPoints.status === (vpShown ? 'known' : 'hidden'));
      }
      if (readOnly || state.choices.status !== 'awaiting-input') {
        continue;
      }
      const root = state.choices.root;
      const undoIndex = (root.options ?? []).findIndex((o) => o.title === 'Undo last action');
      let body;
      if (step >= undoAt && undoAt >= 0 && undoIndex >= 0 && !undone.has(index)) {
        undone.add(index);
        body = {type: 'or', index: undoIndex, response: {type: 'option'}};
        console.log(`${label}: undo`);
      } else {
        body = answer(root, state);
      }
      const response = await fetch(`${base}/player/input?id=${id}`, {method: 'POST', body: JSON.stringify(body)});
      await response.text();
      decisions++;
      acted = true;
      if (response.status !== 200) {
        console.log(`${label}: answer refused (${response.status})`);
      }
    }
    if (readOnly) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      continue;
    }
    if (!acted) {
      const state = await coachState(playerIds[0]);
      if (state.game.gameOver) {
        console.log(`game over at step ${step}`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // A refused answer is recorded as rejected, never as a decision.
  let refused: Response | undefined;
  if (!readOnly) {
    refused = await fetch(`${base}/player/input?id=${playerIds[0]}`, {method: 'POST', body: JSON.stringify({type: 'or', index: 999, response: {type: 'option'}})});
    await refused.text();
  }
  const history = (await get<{tracing: boolean, events: Array<{type: string, error?: string}>}>(`/api/coach/decisions?id=${playerIds[0]}`)).body;
  const final = await coachState(playerIds[0]);
  if (refused !== undefined && !final.game.gameOver) {
    check('refused answer gives 400', refused.status === 400);
    check('refused answer is traced as rejected', history.events.at(-1)?.type === 'rejected');
  }
  check('decision trace is on', history.tracing);

  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
  const failed = checks.filter((c) => !c.ok);
  const summary = {
    players: playerIds.length,
    readOnly,
    answersSent: decisions,
    distinctStates: new Set(fingerprints).size,
    checks: checks.length,
    failed: failed.length,
    failures: failed.slice(0, 50),
    httpLatencyMs: {reads: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p95, max: sorted.at(-1)},
    traceEvents: history.events.reduce((counts: Record<string, number>, e) => ({...counts, [e.type]: (counts[e.type] ?? 0) + 1}), {}),
    finalPhase: final.game.phase,
    finalGeneration: final.game.generation,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (out !== '') {
    let text = JSON.stringify({summary, finalState: final}, null, 2);
    playerIds.forEach((id, i) => {
      text = text.split(id).join(`<player-${i}>`);
    });
    fs.writeFileSync(out, text);
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
