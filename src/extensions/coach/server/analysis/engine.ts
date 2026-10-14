import {createHash} from 'crypto';
import {CoachStateV1} from '../../common/CoachState';
import {COACH_ANALYSIS_SCHEMA, CoachAnalysisV1} from '../../common/CoachAnalysis';
import {buildSynergyGraph} from './synergyGraph';
import {buildCandidates, CandidateLimits, DEFAULT_LIMITS} from './candidates';
import {mechanicsOf} from './mechanicsCatalog';

// The analysis of one snapshot (Gate E): graph, candidate plans with forecasts, coverage. Pure, plus a
// small cache keyed by everything the result depends on, including who asks (results contain the
// asking player's hand and must never be served to someone else).

/** Version of the analysis code. Raise it when results change for the same snapshot. */
export const ANALYSIS_VERSION = '2.0.0';

const HORIZONS: ReadonlyArray<number> = [0, 1, 2, 3];

/** Analyses `state` with a horizon of `horizon` production phases (0–3). */
export function analyze(state: CoachStateV1, horizon: number, limits: CandidateLimits = DEFAULT_LIMITS, now: Date = new Date()): CoachAnalysisV1 {
  if (!HORIZONS.includes(horizon)) {
    throw new Error('horizon must be 0, 1, 2 or 3');
  }
  const graph = buildSynergyGraph(state, {maxUnplayed: limits.maxPool});
  const set = buildCandidates(state, limits, graph, horizon);
  const coverage = {supported: 0, partial: 0, unsupported: 0};
  const reasons = new Map<string, number>();
  for (const node of graph.nodes) {
    const mechanics = mechanicsOf(node.name);
    if (mechanics === undefined) {
      coverage.unsupported++;
      reasons.set('not in the card catalog', (reasons.get('not in the card catalog') ?? 0) + 1);
      continue;
    }
    if (mechanics.support === 'supported' || mechanics.support === 'none') {
      coverage.supported++;
    } else if (mechanics.support === 'partial') {
      coverage.partial++;
    } else {
      coverage.unsupported++;
    }
    for (const kind of new Set(mechanics.unmodeled.map((u) => u.kind))) {
      reasons.set(kind, (reasons.get(kind) ?? 0) + 1);
    }
  }
  return {
    schemaVersion: COACH_ANALYSIS_SCHEMA,
    source: {
      fingerprint: state.fingerprint,
      advisoryFingerprint: state.advisoryFingerprint,
      catalogVersion: state.catalogVersion,
      analysisVersion: ANALYSIS_VERSION,
      generatedAt: now.toISOString(),
    },
    horizonProductionPhases: horizon,
    coverage: {
      ...coverage,
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([kind, n]) => `${kind}: ${n} card${n === 1 ? '' : 's'}`),
    },
    candidates: set.candidates,
    discarded: set.discarded,
    limitations: [...graph.notProduced.map((n) => `${n.kind}: ${n.reason}`), ...graph.limitations],
    warnings: [...state.warnings.map((w) => w.message), ...set.warnings],
    search: set.search,
  };
}

/** Results by key; insertion order gives the least recently used entry. */
const cache = new Map<string, CoachAnalysisV1>();
const CACHE_SIZE = 64;
let computed = 0;

/**
 * Key of a cached analysis: everything the result depends on. `viewer` is hashed so the key holds no id.
 */
export function cacheKey(state: CoachStateV1, horizon: number, viewer: string): string {
  const who = createHash('sha256').update(viewer).digest('hex').slice(0, 16);
  return [state.fingerprint, state.advisoryFingerprint, state.catalogVersion, ANALYSIS_VERSION, horizon, who].join('|');
}

/** The analysis of `state` for `viewer` (the player id), from the cache when nothing it depends on changed. */
export function cachedAnalysis(state: CoachStateV1, horizon: number, viewer: string): CoachAnalysisV1 {
  const key = cacheKey(state, horizon, viewer);
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = analyzer(state, horizon);
  computed++;
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) {
    cache.delete(cache.keys().next().value as string);
  }
  return result;
}

let analyzer: (state: CoachStateV1, horizon: number) => CoachAnalysisV1 = (state, horizon) => analyze(state, horizon);

/** for testing */
export function setAnalyzerForTesting(next: ((state: CoachStateV1, horizon: number) => CoachAnalysisV1) | undefined) {
  analyzer = next ?? ((state, horizon) => analyze(state, horizon));
  cache.clear();
}

/** for testing: number of analyses computed (not served from the cache). */
export function analysesComputed(): number {
  return computed;
}
