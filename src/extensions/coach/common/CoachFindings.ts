// Decisions of a solo game that could have been better, found with evidence (P3-SOLO-2,
// `coach-findings/1`), served by `GET api/coach/findings`. See docs/coach/phase3/solo-coach-design.md §5.
//
// A finding judges one decision from what the player could see when taking it (the snapshot before it),
// and only from one point of view (a discount, a requirement, a payback). It never says "best" or
// "mistake": it says that, from this point of view, the alternative was better by a computed amount.
import {SoloRules} from './CoachTimeline';
import {CoachLabel} from './CoachChoiceList';
import {UpcomingHint} from './CoachReflection';

export const COACH_FINDINGS_SCHEMA = 'coach-findings/1';

export const FINDING_KINDS = ['play-order-discount', 'unplayable-purchase', 'production-payback'] as const;
/**
 * - `play-order-discount`: card Y played after card X could have been played first and lowered X's cost.
 * - `unplayable-purchase`: a card bought when one of its requirements could no longer be met.
 * - `production-payback`: a production card played too late to pay back its cost in M€.
 */
export type FindingKind = typeof FINDING_KINDS[number];

/** One fact a finding rests on, with where it comes from. */
export type FindingEvidence = {
  id: string,
  kind: 'cost' | 'offered' | 'discount' | 'resources' | 'requirement' | 'forecast' | 'payment-check' | 'purchase' | 'later-play',
  /** Where the value was read: the snapshot before or after a recorded decision, the card catalog, or the analysis. */
  source: {seq?: number, position?: 'before' | 'after', catalog?: string, analysis?: string},
  value: Readonly<Record<string, unknown>>,
  support: 'verified' | 'conditional' | 'unknown',
};

export type CoachFindingV1 = {
  /** Stable id from the kind and the decisions involved (same history, same id). */
  id: string,
  kind: FindingKind,
  /** The decision judged. */
  decision: {eventId: string, seq: number, generation: number},
  /** Other events the finding uses (e.g. the later play of the discount card). */
  related: ReadonlyArray<string>,
  actual: {summary: CoachLabel, megacredits?: number},
  alternative: {summary: CoachLabel, megacredits?: number},
  /** What the alternative changes, from this point of view only (positive: the alternative is better). */
  difference?: {megacredits: number},
  evidence: ReadonlyArray<FindingEvidence>,
  /** `verified`: every step is backed by evidence. `conditional`: rests on assumptions. */
  confidence: 'verified' | 'conditional' | 'unknown',
  /** Effects the evaluation cannot count (the conclusion may change with them). */
  unmodeled: ReadonlyArray<string>,
  /** Points of view the evaluation does not cover (reason codes). */
  limits: ReadonlyArray<string>,
  /** True when the finding may be used for a question to the player (P3-SOLO-3). */
  intervention: boolean,
  severity: 'minor' | 'notable',
};

export type CoachFindingsV1 = {
  schemaVersion: typeof COACH_FINDINGS_SCHEMA,
  status: 'ok' | 'disabled' | 'unreadable' | 'not-solo',
  solo?: SoloRules,
  findings: ReadonlyArray<CoachFindingV1>,
  /** What was checked, and why some decisions were left out (reason codes with counts). */
  checked: ReadonlyArray<{kind: FindingKind, decisions: number, skipped: ReadonlyArray<{reason: string, count: number}>}>,
  /** Hints for the position now (only when asked for with `upcoming=1`; P3-SOLO-3). */
  upcoming?: ReadonlyArray<UpcomingHint>,
};
