// Read-only check of a coach trace folder (Phase 1.5, docs/coach/operations.md).
//
//   npx tsx scripts/coach/verifyTrace.ts <COACH_TRACE_DIR>
//
// For every game it reports lines that are not JSON, events that refer to a missing snapshot, snapshots
// whose fingerprint does not match their content, Phase 1 (legacy) records and the event series. It never
// changes files or modes. Game ids are secrets: games are shown by a short hash of the file name.
import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {CoachStateRecord, CoachStateRef, CoachTraceEvent} from '../../src/extensions/coach/common/CoachTrace';
import {advisoryFingerprintOf, fingerprintOf} from '../../src/extensions/coach/server/fingerprint';
import {annotateSeries} from '../../src/extensions/coach/server/integrity';

type GameReport = {
  game: string,
  events: number,
  states: number,
  corruptLines: {trace: number, states: number},
  /** Events pointing at a snapshot that is not stored (must be 0). */
  danglingRefs: number,
  /** Stored snapshots whose content no longer gives their fingerprint (must be 0). */
  fingerprintMismatches: number,
  legacyStates: number,
  legacyRefs: number,
  series: Record<string, number>,
  types: Record<string, number>,
  modes: {trace?: string, states?: string},
};

function readLines(file: string): {records: Array<unknown>, corrupt: number} {
  if (!fs.existsSync(file)) {
    return {records: [], corrupt: 0};
  }
  const records: Array<unknown> = [];
  let corrupt = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.length === 0) {
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch {
      corrupt++;
    }
  }
  return {records, corrupt};
}

function refsOf(event: CoachTraceEvent): Array<CoachStateRef> {
  switch (event.type) {
  case 'decision':
    return [event.before, event.after];
  case 'rejected':
    return [event.before];
  case 'revert':
    return event.to === undefined ? [event.from] : [event.from, event.to];
  case 'integrity':
    return [event.observed];
  }
}

function modeOf(file: string): string | undefined {
  return fs.existsSync(file) ? (fs.lstatSync(file).mode & 0o777).toString(8).padStart(4, '0') : undefined;
}

function verifyGame(directory: string, prefix: string): GameReport {
  const traceFile = path.join(directory, `${prefix}.trace.jsonl`);
  const statesFile = path.join(directory, `${prefix}.states.jsonl`);
  const trace = readLines(traceFile);
  const states = readLines(statesFile);
  const events = (trace.records as Array<CoachTraceEvent>).filter((e) => e?.schemaVersion === 'coach-trace/1').sort((a, b) => a.seq - b.seq);
  const records = states.records as Array<CoachStateRecord>;

  const stored = new Set<string>();
  let mismatches = 0;
  let legacyStates = 0;
  for (const record of records) {
    const {game, me, opponents, choices, warnings} = record.state;
    if (fingerprintOf({game, me, opponents, choices}) !== record.fingerprint) {
      mismatches++;
    }
    if (record.advisoryFingerprint === undefined) {
      legacyStates++;
    } else if (advisoryFingerprintOf({game, me, opponents, choices, warnings}) !== record.advisoryFingerprint) {
      mismatches++;
    }
    stored.add(`${record.color}:${record.fingerprint}`);
    stored.add(`${record.color}:${record.fingerprint}:${record.advisoryFingerprint ?? ''}`);
  }

  let dangling = 0;
  let legacyRefs = 0;
  const types: Record<string, number> = {};
  for (const event of events) {
    types[event.type] = (types[event.type] ?? 0) + 1;
    for (const ref of refsOf(event)) {
      if (ref.advisoryFingerprint === undefined) {
        legacyRefs++;
        if (!stored.has(`${event.player.color}:${ref.fingerprint}`)) {
          dangling++;
        }
      } else if (!stored.has(`${event.player.color}:${ref.fingerprint}:${ref.advisoryFingerprint}`)) {
        dangling++;
      }
    }
  }
  const series: Record<string, number> = {};
  for (const value of annotateSeries(events).values()) {
    series[value] = (series[value] ?? 0) + 1;
  }
  return {
    game: createHash('sha256').update(prefix).digest('hex').slice(0, 8),
    events: events.length,
    states: records.length,
    corruptLines: {trace: trace.corrupt, states: states.corrupt},
    danglingRefs: dangling,
    fingerprintMismatches: mismatches,
    legacyStates,
    legacyRefs,
    series,
    types,
    modes: {trace: modeOf(traceFile), states: modeOf(statesFile)},
  };
}

function main() {
  const directory = process.argv[2];
  if (directory === undefined) {
    console.error('usage: verifyTrace.ts <COACH_TRACE_DIR>');
    process.exitCode = 2;
    return;
  }
  const prefixes = new Set(fs.readdirSync(directory)
    .map((name) => /^([A-Za-z0-9_-]+)\.(trace|states)\.jsonl$/.exec(name)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined));
  const games = [...prefixes].sort().map((prefix) => verifyGame(directory, prefix));
  const problems = games.filter((g) => g.danglingRefs > 0 || g.fingerprintMismatches > 0);
  const summary = {
    folderMode: modeOf(directory),
    games: games.length,
    gamesWithCorruptLines: games.filter((g) => g.corruptLines.trace + g.corruptLines.states > 0).length,
    gamesWithProblems: problems.length,
    filesNot0600: games.filter((g) => [g.modes.trace, g.modes.states].some((m) => m !== undefined && m !== '0600')).length,
  };
  console.log(JSON.stringify({summary, games}, null, 2));
  process.exitCode = problems.length > 0 ? 1 : 0;
}

main();
