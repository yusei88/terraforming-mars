import {reactive} from 'vue';
import {CoachFindingsV1} from '../common/CoachFindings';

// What the solo coach shares between the watcher (indicator, cut-in) and the panel (P3-SOLO-3).
// Settings and the findings the player has handled are kept in this browser only.

type Stored = {handled: Array<string>, later: Array<string>, watch: boolean, before: boolean};

const KEY = 'coach.solo';
const MAX_IDS = 300;

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    return {
      handled: Array.isArray(raw.handled) ? raw.handled.filter((x) => typeof x === 'string') : [],
      later: Array.isArray(raw.later) ? raw.later.filter((x) => typeof x === 'string') : [],
      watch: raw.watch !== false,
      before: raw.before === true,
    };
  } catch {
    return {handled: [], later: [], watch: true, before: false};
  }
}

export const coachSoloState = reactive({
  ...load(),
  findings: undefined as CoachFindingsV1 | undefined,
  /** Finding the panel's reflection shows. */
  reflectionId: undefined as string | undefined,
  /** Tab the panel shows. */
  tab: 'choices' as 'choices' | 'timeline' | 'reflect',
});

export function saveSoloState(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      handled: coachSoloState.handled.slice(-MAX_IDS), later: coachSoloState.later.slice(-MAX_IDS),
      watch: coachSoloState.watch, before: coachSoloState.before,
    }));
  } catch {
    // The settings then last for this page only.
  }
}

/** Reviewed or dismissed: never shown as new again. */
export function markHandled(id: string): void {
  if (!coachSoloState.handled.includes(id)) {
    coachSoloState.handled.push(id);
  }
  coachSoloState.later = coachSoloState.later.filter((x) => x !== id);
  saveSoloState();
}

/** Kept for later: counted as unread, not shown again as a cut-in. */
export function markLater(id: string): void {
  if (!coachSoloState.later.includes(id)) {
    coachSoloState.later.push(id);
  }
  saveSoloState();
}

/** Findings that may be asked about and that the player has not handled yet. */
export function unreadFindings() {
  return (coachSoloState.findings?.findings ?? []).filter((f) => f.intervention && !coachSoloState.handled.includes(f.id));
}
