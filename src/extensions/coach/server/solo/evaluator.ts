import {COACH_FINDINGS_SCHEMA, CoachFindingsV1, CoachFindingV1, FindingKind} from '../../common/CoachFindings';
import {EvaluatedEvent} from './evidence';
import {EvaluationResult, playOrderFindings} from './counterfactual';
import {purchaseFindings} from './purchases';
import {paybackFindings} from './payback';
import {loadTimeline, soloRules, TimelineSource} from './timeline';
import {upcomingHints} from './prospective';

// SoloStrategyEvaluator (P3-SOLO-2): runs the evaluators over the current line of play and marks the
// findings that may become a question to the player (InterventionCandidate). Deterministic, read-only,
// no language model.

/** Least M€ difference for a question to the player (smaller differences are kept, but not asked about). */
export const INTERVENTION_MIN_MEGACREDITS = 2;

/**
 * InterventionCandidate: a finding may lead to a question only when every step is verified, the
 * difference is large enough, and no unmodeled effect could change the conclusion.
 */
export function isInterventionCandidate(finding: CoachFindingV1): boolean {
  return finding.confidence === 'verified' &&
    finding.unmodeled.length === 0 &&
    (finding.difference?.megacredits ?? 0) >= INTERVENTION_MIN_MEGACREDITS;
}

const EVALUATORS: ReadonlyArray<[FindingKind, (events: ReadonlyArray<EvaluatedEvent>) => EvaluationResult]> = [
  ['play-order-discount', playOrderFindings],
  ['unplayable-purchase', purchaseFindings],
  ['production-payback', paybackFindings],
];

export function evaluate(events: ReadonlyArray<EvaluatedEvent>): Pick<CoachFindingsV1, 'findings' | 'checked'> {
  const findings: Array<CoachFindingV1> = [];
  const checked: Array<CoachFindingsV1['checked'][number]> = [];
  for (const [kind, evaluator] of EVALUATORS) {
    const result = evaluator(events);
    findings.push(...result.findings.map((f) => ({...f, intervention: isInterventionCandidate(f)})));
    checked.push({kind, decisions: result.decisions, skipped: [...result.skipped].map(([reason, count]) => ({reason, count}))});
  }
  // The same finding is reported once (ids are stable per kind and decisions).
  const unique = new Map(findings.map((f) => [f.id, f]));
  return {findings: [...unique.values()].sort((a, b) => a.decision.seq - b.decision.seq), checked};
}

/** The findings of the player's solo game (GET api/coach/findings); `upcoming` adds hints for the position now. */
export function buildFindings(source: TimelineSource, options: {upcoming?: boolean} = {}): CoachFindingsV1 {
  const loaded = loadTimeline(source);
  const solo = soloRules(source.state);
  const base = {schemaVersion: COACH_FINDINGS_SCHEMA, status: loaded.status, ...(solo === undefined ? {} : {solo})} as const;
  if (loaded.status !== 'ok') {
    return {...base, findings: [], checked: []};
  }
  return {...base, ...evaluate(loaded.events), ...(options.upcoming ? {upcoming: upcomingHints(source.state)} : {})};
}
