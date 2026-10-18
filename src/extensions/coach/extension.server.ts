// Strategy coach: read-only game state, a history of human decisions (Phase 1, 1.5) and the analysis of
// combos, requirements and forecasts (Phase 2), and the coaching of options the player chooses (Phase 3,
// choice-driven). See docs/coach/.
import {ServerExtension} from '@/server/extensions/ServerExtension';
import {ApiCoachAnalysis, ApiCoachCatalog, ApiCoachCounsel, ApiCoachDecisions, ApiCoachOptions, ApiCoachFindings, ApiCoachReflection, ApiCoachState, ApiCoachTimeline, COACH_PATHS} from './server/routes';
import {coachTraceObserver} from './server/coachTrace';

export const extension: ServerExtension = {
  name: 'coach',
  routes: [
    [COACH_PATHS.STATE, ApiCoachState.INSTANCE],
    [COACH_PATHS.CATALOG, ApiCoachCatalog.INSTANCE],
    [COACH_PATHS.DECISIONS, ApiCoachDecisions.INSTANCE],
    [COACH_PATHS.ANALYSIS, ApiCoachAnalysis.INSTANCE],
    [COACH_PATHS.OPTIONS, ApiCoachOptions.INSTANCE],
    [COACH_PATHS.COUNSEL, ApiCoachCounsel.INSTANCE],
    [COACH_PATHS.TIMELINE, ApiCoachTimeline.INSTANCE],
    [COACH_PATHS.FINDINGS, ApiCoachFindings.INSTANCE],
    [COACH_PATHS.REFLECTION, ApiCoachReflection.INSTANCE],
  ],
  inputObserver: coachTraceObserver,
};
