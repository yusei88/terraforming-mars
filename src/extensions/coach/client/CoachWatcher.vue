<!-- Solo coach watcher (P3-SOLO-3): a small indicator while the coach watches the player's decisions, and
     one small cut-in at a time when a recent decision is worth looking back on (after the move, never
     before unless the player turned hints before acting on). Reads the findings when the game moves on
     (no timer); never changes the game. -->
<template>
  <div v-if="active" class="coach-watcher">
    <button v-if="!panelOpen" type="button" class="coach-watcher__indicator" data-test="watch-indicator"
      :aria-label="$t('Strategy coach')" @click="openReflection(undefined)">
      <span class="coach-watcher__eye" aria-hidden="true">●</span>
      <span class="coach-watcher__generation">{{ show({template: 'G${0}', params: [{text: String(generation)}]}) }}</span>
      <span v-if="unread > 0" class="coach-watcher__badge" data-test="watch-unread">{{ unread }}</span>
    </button>

    <div v-if="toast !== undefined && !panelOpen" class="coach-watcher__toast" role="status" data-test="cut-in">
      <template v-if="toast.type === 'finding'">
        <p class="coach-watcher__toast-label" v-i18n>Looking back</p>
        <p class="coach-watcher__toast-text">{{ show(toast.question) }}</p>
        <div class="coach-watcher__toast-actions">
          <button type="button" data-test="cut-in-open" @click="openReflection(toast.id)" v-i18n>Look back</button>
          <button type="button" data-test="cut-in-later" @click="later(toast.id)" v-i18n>Later</button>
          <button type="button" data-test="cut-in-close" @click="dismiss(toast.id)" v-i18n>Close</button>
        </div>
      </template>
      <template v-else>
        <p class="coach-watcher__toast-label" v-i18n>Before you act</p>
        <p class="coach-watcher__toast-text" v-i18n>The order in which you play your cards this generation can change what they cost.</p>
        <p v-if="toast.revealed" class="coach-watcher__toast-text" data-test="cut-in-cards">{{ show({template: 'Look at ${0} and ${1}.', params: toast.cards.map((c) => ({text: c, card: true}))}) }}</p>
        <div class="coach-watcher__toast-actions">
          <button v-if="!toast.revealed" type="button" data-test="cut-in-reveal" @click="toast.revealed = true" v-i18n>Which cards?</button>
          <button type="button" data-test="cut-in-close" @click="dismiss(toast.id)" v-i18n>Close</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {ViewModel} from '@/common/models/PlayerModel';
import {translateText, translateTextWithParams} from '@/client/directives/i18n';
import {CoachFindingsV1, CoachFindingV1} from '../common/CoachFindings';
import {CoachLabel} from '../common/CoachChoiceList';
import {coachPanelState} from './coachPanelState';
import {coachSoloState, markHandled, markLater, unreadFindings} from './coachSoloState';

const props = defineProps<{view: ViewModel | undefined}>();

type Toast =
  {type: 'finding', id: string, question: CoachLabel} |
  {type: 'upcoming', id: string, cards: ReadonlyArray<string>, revealed: boolean};

const toast = ref<Toast | undefined>(undefined);
/* Findings that existed when the page opened: counted, never popped up. */
let baseline: Set<string> | undefined;
let request = 0;

const playerId = computed(() => {
  const view = props.view;
  return view !== undefined && view.thisPlayer !== undefined && typeof view.id === 'string' && view.id.startsWith('p') ? view.id : undefined;
});
const solo = computed(() => (props.view?.players?.length ?? 0) === 1);
const active = computed(() => playerId.value !== undefined && solo.value && coachSoloState.watch);
const panelOpen = computed(() => coachPanelState.open);
const generation = computed(() => props.view?.game?.generation ?? 0);
const unread = computed(() => unreadFindings().length);
const position = computed(() => {
  const game = props.view?.game;
  return game === undefined ? '' : `${game.gameAge}:${game.undoCount}:${game.step}:${game.phase}`;
});

function show(line: CoachLabel): string {
  return translateTextWithParams(line.template, line.params.map((p) => (p.card ? translateText(p.text) : p.text)));
}

/** The first question of a finding, in the past tense, without the answer. */
function questionOf(finding: CoachFindingV1): CoachLabel {
  const [first, second] = finding.actual.summary.params;
  switch (finding.kind) {
  case 'play-order-discount':
    return {template: 'What made you play ${0} before ${1}?', params: [first, second]};
  case 'unplayable-purchase':
    return {template: 'What did you plan to do with ${0} when you bought it?', params: [first]};
  case 'production-payback':
    return {template: 'Why did you play ${0} at that moment?', params: [first]};
  }
}

function openReflection(id: string | undefined) {
  toast.value = undefined;
  coachSoloState.reflectionId = id;
  coachSoloState.tab = 'reflect';
  coachPanelState.open = true;
}

function later(id: string) {
  markLater(id);
  toast.value = undefined;
}

function dismiss(id: string) {
  markHandled(id);
  toast.value = undefined;
}

function pickToast(findings: CoachFindingsV1) {
  const handled = new Set([...coachSoloState.handled, ...coachSoloState.later]);
  // An upcoming hint for an earlier position is no longer valid.
  if (toast.value?.type === 'upcoming' && !(findings.upcoming ?? []).some((h) => h.id === toast.value?.id)) {
    toast.value = undefined;
  }
  if (toast.value !== undefined || coachPanelState.open) {
    return;
  }
  const fresh = unreadFindings().find((f) => f.severity === 'notable' && !handled.has(f.id) && !(baseline?.has(f.id) ?? false));
  if (fresh !== undefined) {
    toast.value = {type: 'finding', id: fresh.id, question: questionOf(fresh)};
    return;
  }
  const hint = coachSoloState.before ? (findings.upcoming ?? []).find((h) => !handled.has(h.id)) : undefined;
  if (hint !== undefined) {
    toast.value = {type: 'upcoming', id: hint.id, cards: hint.cards, revealed: false};
  }
}

async function load(): Promise<void> {
  const id = playerId.value;
  if (id === undefined || !active.value) {
    return;
  }
  const mine = ++request;
  try {
    const response = await fetch(`api/coach/findings?id=${encodeURIComponent(id)}&upcoming=${coachSoloState.before ? 1 : 0}`, {cache: 'no-store'});
    if (!response.ok) {
      return;
    }
    const findings = await response.json() as CoachFindingsV1;
    if (mine !== request) {
      return;
    }
    coachSoloState.findings = findings;
    if (baseline === undefined) {
      baseline = new Set(findings.findings.filter((f) => f.intervention).map((f) => f.id));
    }
    pickToast(findings);
  } catch {
    // The coach is quiet when it cannot read: the game goes on.
  }
}

watch(() => [position.value, playerId.value, active.value, coachSoloState.before], () => {
  void load();
}, {immediate: true});

defineExpose({load});
</script>

<style scoped lang="less">
.coach-watcher__indicator {
  position: fixed;
  /* Right edge, under the top bar and the task line of the mobile layout; above the board only. */
  top: calc(108px + env(safe-area-inset-top));
  right: 10px;
  z-index: 24;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  padding: 4px 10px;
  color: #eee;
  background: rgba(18, 22, 30, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 18px;
  font-size: 12px;
}
.coach-watcher__eye {
  color: #7fd47f;
  font-size: 10px;
}
.coach-watcher__badge {
  min-width: 18px;
  padding: 0 5px;
  color: #12161e;
  background: #f5c76a;
  border-radius: 9px;
  font-weight: bold;
  text-align: center;
}
.coach-watcher__toast {
  position: fixed;
  top: calc(150px + env(safe-area-inset-top));
  right: 10px;
  z-index: 24;
  width: min(340px, calc(100vw - 20px));
  padding: 8px 10px;
  color: #eee;
  background: #12161e;
  border: 1px solid rgba(245, 199, 106, 0.6);
  border-radius: 10px;
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}
.coach-watcher__toast-label {
  margin: 0 0 2px;
  font-size: 11px;
  color: #f5c76a;
}
.coach-watcher__toast-text {
  margin: 2px 0;
}
.coach-watcher__toast-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  button {
    min-height: 32px;
    padding: 2px 10px;
  }
}
</style>

<style lang="less">
/* Not scoped (the scoped compiler breaks :has() inside :global()). The game log screen has its filter
   toggle where the indicator sits: move below it. */
body:has(.mb-home--log) .coach-watcher__indicator {
  top: calc(156px + env(safe-area-inset-top));
}
body:has(.mb-home--log) .coach-watcher__toast {
  top: calc(198px + env(safe-area-inset-top));
}
/* Landscape players screen: the players table runs across the top. */
@media (min-width: 900px) and (orientation: landscape) {
  body:has(.mb-home--players) .coach-watcher__indicator {
    top: calc(166px + env(safe-area-inset-top));
  }
  body:has(.mb-home--players) .coach-watcher__toast {
    top: calc(208px + env(safe-area-inset-top));
  }
}
</style>
