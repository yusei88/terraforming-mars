import {expect} from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {fileSink, traceFileName} from '../../../src/extensions/coach/server/traceStore';
import {CoachTracer} from '../../../src/extensions/coach/server/coachTrace';
import {GameId} from '../../../src/common/Types';
import {testGame} from '../../TestGame';
import {Phase} from '../../../src/common/Phase';
import {PowerPlant} from '../../../src/server/cards/base/PowerPlant';
import {CardName} from '../../../src/common/cards/CardName';
import {Payment} from '../../../src/common/inputs/Payment';
import {InputResponse} from '../../../src/common/inputs/InputResponse';
import {projectCoachState} from '../../../src/extensions/coach/server/projectCoachState';

const GAME = 'g-store-test' as GameId;

function mode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

// P1.5-01 / P1.5-05: H01-H06
describe('coach traceStore', () => {
  let root: string;
  let savedUmask: number;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-store-'));
    savedUmask = process.umask(0o022);
  });

  afterEach(() => {
    process.umask(savedUmask);
    for (const entry of fs.readdirSync(root, {recursive: true}) as Array<string>) {
      try {
        fs.chmodSync(path.join(root, entry), 0o700);
      } catch {
        // Links and removed entries.
      }
    }
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, {recursive: true, force: true});
  });

  // H01
  it('creates the folder 0700 and files 0600 under umask 022', () => {
    const directory = path.join(root, 'trace');
    const sink = fileSink(directory);
    expect(sink.append(GAME, 'trace', {a: 1})).deep.eq({ok: true});
    expect(sink.append(GAME, 'states', {b: 2})).deep.eq({ok: true});
    expect(mode(directory)).eq(0o700);
    expect(mode(traceFileName(directory, GAME, 'trace'))).eq(0o600);
    expect(mode(traceFileName(directory, GAME, 'states'))).eq(0o600);
    expect(sink.read(GAME, 'trace')).deep.eq({records: [{a: 1}], corruptLines: 0});
    expect(sink.health().status).eq('ok');
    sink.append(GAME, 'states', {fingerprint: 'ff00'});
    expect(sink.readMatching(GAME, 'states', 'ff00')).deep.eq([{fingerprint: 'ff00'}]);
  });

  // H02
  it('restricts existing trace files and leaves other files alone', () => {
    const directory = path.join(root, 'trace');
    fs.mkdirSync(directory, {mode: 0o755});
    fs.chmodSync(directory, 0o755);
    const trace = traceFileName(directory, GAME, 'trace');
    fs.writeFileSync(trace, '{"old":true}\n', {mode: 0o644});
    fs.chmodSync(trace, 0o644);
    const unrelated = path.join(directory, 'notes.txt');
    fs.writeFileSync(unrelated, 'keep', {mode: 0o644});
    fs.chmodSync(unrelated, 0o644);

    const sink = fileSink(directory);
    expect(mode(directory)).eq(0o700);
    expect(mode(trace)).eq(0o600);
    expect(mode(unrelated)).eq(0o644);
    expect(fs.readFileSync(trace, 'utf8')).eq('{"old":true}\n');
    expect(sink.health().permissionsFixed).eq(2);
    expect(sink.read(GAME, 'trace').records).deep.eq([{old: true}]);
  });

  // H03
  it('refuses a trace file that is a symbolic link and leaves its target alone', () => {
    const directory = path.join(root, 'trace');
    fs.mkdirSync(directory, {mode: 0o700});
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret target', {mode: 0o644});
    fs.symlinkSync(outside, traceFileName(directory, GAME, 'trace'));

    const sink = fileSink(directory);
    expect(sink.append(GAME, 'trace', {a: 1}).ok).is.false;
    expect(fs.readFileSync(outside, 'utf8')).eq('secret target');
    expect(mode(outside)).eq(0o644);
    expect(sink.health().status).eq('degraded');
    expect(sink.health().filesRefused).eq(1);
    // Other games still work.
    expect(sink.append('g-other' as GameId, 'trace', {b: 1}).ok).is.true;
  });

  it('refuses a link created after start (no following links when opening)', () => {
    const directory = path.join(root, 'trace');
    const sink = fileSink(directory);
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'x');
    fs.symlinkSync(outside, traceFileName(directory, GAME, 'states'));
    expect(sink.append(GAME, 'states', {a: 1}).ok).is.false;
    expect(fs.readFileSync(outside, 'utf8')).eq('x');
  });

  it('refuses a trace folder that is a symbolic link', () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, {mode: 0o755});
    fs.chmodSync(real, 0o755);
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    const sink = fileSink(link);
    expect(sink.health().status).eq('refused');
    expect(sink.append(GAME, 'trace', {a: 1}).ok).is.false;
    expect(fs.readdirSync(real)).is.empty;
    expect(mode(real)).eq(0o755);
  });

  it('refuses a folder owned by another user', () => {
    const directory = path.join(root, 'trace');
    fs.mkdirSync(directory, {mode: 0o755});
    fs.chmodSync(directory, 0o755);
    const getuid = process.getuid;
    // Pretend to be someone else: the folder then belongs to "another user".
    process.getuid = () => (getuid?.call(process) ?? 0) + 1;
    try {
      const sink = fileSink(directory);
      expect(sink.health().status).eq('refused');
      expect(sink.health().refusedReason).contains('another user');
      expect(sink.append(GAME, 'trace', {a: 1}).ok).is.false;
    } finally {
      process.getuid = getuid;
    }
    expect(mode(directory)).eq(0o755);
    expect(fs.readdirSync(directory)).is.empty;
  });

  // H04
  it('reports write errors and keeps the game going', () => {
    const directory = path.join(root, 'trace');
    let fail: string | undefined = 'ENOSPC';
    const sink = fileSink(directory, {beforeWrite: () => fail});
    const tracer = new CoachTracer(sink);
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    player.megaCredits = 20;
    player.cardsInHand.push(new PowerPlant());
    player.takeAction();
    const state = projectCoachState(player);
    const index = state.choices.status === 'awaiting-input' ? state.choices.root.options!.findIndex((o) => o.inputType === 'projectCard') : -1;
    const response: InputResponse = {type: 'or', index, response: {type: 'projectCard', card: CardName.POWER_PLANT, payment: Payment.of({megacredits: 4})}};

    const done = tracer.observer.beforeInput(player, response, 0)!;
    player.process(response);
    done({accepted: true});

    expect(player.tableau.has(CardName.POWER_PLANT)).is.true;
    const health = tracer.health();
    expect(health.status).eq('degraded');
    expect(health.writeFailures).deep.eq({ENOSPC: 1});
    expect(health.eventsDropped).eq(1);
    expect(fs.existsSync(traceFileName(directory, game.id, 'trace'))).is.false;

    // The disk has room again: the next event is number 1 and its snapshots are stored first.
    fail = undefined;
    const next = tracer.observer.beforeInput(player, {type: 'option'}, 0)!;
    next({accepted: false, error: 'x'});
    const events = sink.read(game.id, 'trace').records as Array<{seq: number, before: {fingerprint: string}}>;
    expect(events.map((e) => e.seq)).deep.eq([1]);
    const stored = (sink.read(game.id, 'states').records as Array<{fingerprint: string}>).map((r) => r.fingerprint);
    expect(stored).includes(events[0].before.fingerprint);
  });

  it('reports a folder that became unwritable (EACCES)', () => {
    const directory = path.join(root, 'trace');
    const sink = fileSink(directory);
    fs.chmodSync(directory, 0o500);
    const result = sink.append(GAME, 'trace', {a: 1});
    expect(result).deep.eq({ok: false, code: 'EACCES'});
    expect(sink.health().writeFailures).deep.eq({EACCES: 1});
  });

  // H06
  it('isolates a cut last line without touching the lines before it', () => {
    const directory = path.join(root, 'trace');
    const sink = fileSink(directory);
    sink.append(GAME, 'trace', {seq: 1});
    const file = traceFileName(directory, GAME, 'trace');
    fs.appendFileSync(file, '{"seq":2,"cut');
    const before = fs.readFileSync(file, 'utf8');

    const restarted = fileSink(directory);
    expect(restarted.read(GAME, 'trace')).deep.eq({records: [{seq: 1}], corruptLines: 1});
    expect(restarted.append(GAME, 'trace', {seq: 2}).ok).is.true;
    const after = fs.readFileSync(file, 'utf8');
    expect(after.startsWith(before)).is.true;
    expect(restarted.read(GAME, 'trace')).deep.eq({records: [{seq: 1}, {seq: 2}], corruptLines: 1});
    expect(restarted.health().tornLinesIsolated).eq(1);
  });
});
