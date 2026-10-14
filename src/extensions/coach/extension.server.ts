// Strategy coach, Phase 1: read-only game state for analysis and a history of human decisions.
// See docs/coach/phase1-design.md.
import {ServerExtension} from '@/server/extensions/ServerExtension';
import {ApiCoachCatalog, ApiCoachDecisions, ApiCoachState, COACH_PATHS} from './server/routes';
import {coachTraceObserver} from './server/coachTrace';

export const extension: ServerExtension = {
  name: 'coach',
  routes: [
    [COACH_PATHS.STATE, ApiCoachState.INSTANCE],
    [COACH_PATHS.CATALOG, ApiCoachCatalog.INSTANCE],
    [COACH_PATHS.DECISIONS, ApiCoachDecisions.INSTANCE],
  ],
  inputObserver: coachTraceObserver,
};
