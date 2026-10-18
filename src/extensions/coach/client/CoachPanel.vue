<!-- Strategy coach (Phase 3, choice-driven): the options of the current position (Now: what the game
     accepts; Future: plans of the analysis). The player picks one, sees its facts, and asks for a review
     (strengths, cautions, outlook, one question). Picking here never plays anything. Under the top bar,
     like Gate F, so the game's action sheet, navigation and undo stay usable. -->
<template>
  <aside v-if="state.open" class="coach-panel" role="dialog" :aria-label="$t('Strategy coach')">
    <header class="coach-panel__header">
      <h2 class="coach-panel__title" v-i18n>Strategy coach</h2>
      <div v-if="solo" class="coach-panel__tabs" role="tablist">
        <button type="button" role="tab" class="coach-panel__tab" :aria-selected="tab === 'choices'" data-test="tab-choices" @click="tab = 'choices'" v-i18n>Choices</button>
        <button type="button" role="tab" class="coach-panel__tab" :aria-selected="tab === 'timeline'" data-test="tab-timeline" @click="tab = 'timeline'" v-i18n>Timeline</button>
      </div>
      <button type="button" class="coach-panel__button" data-test="refresh" @click="refresh" v-i18n>Refresh</button>
      <button type="button" class="coach-panel__button" data-test="close" @click="close" v-i18n>Close</button>
    </header>

    <div class="coach-panel__body">
      <p v-if="playerId === undefined" class="coach-panel__note" v-i18n>The coach is only for players.</p>

      <!-- Timeline of the decisions (solo games, P3-SOLO-1) -->
      <template v-else-if="tab === 'timeline'">
        <p v-if="timelineFailed" class="coach-panel__note" data-test="timeline-error" v-i18n>The coach is not available right now.</p>
        <p v-else-if="timeline === undefined" class="coach-panel__note" v-i18n>Loading the analysis</p>
        <template v-else>
          <p v-if="timelineStatusNote(timeline) !== undefined" class="coach-panel__note" data-test="timeline-status">{{ $t(timelineStatusNote(timeline) ?? '') }}</p>
          <template v-else>
            <p v-if="timeline.history !== 'valid'" class="coach-panel__warning" v-i18n>The history may be incomplete (an undo or restart was detected).</p>
            <p v-if="victoryLine(timeline) !== undefined" class="coach-panel__note">{{ show(victoryLine(timeline)!) }}</p>
            <p class="coach-panel__note" data-test="timeline-now">{{ show({template: 'Now: generation ${0}, TR ${1}', params: [{text: String(timeline.now.generation)}, {text: String(timeline.now.terraformRating)}]}) }}<template v-if="timeline.now.victoryPoints !== undefined"> · {{ show({template: 'VP now: ${0}', params: [{text: String(timeline.now.victoryPoints)}]}) }}</template></p>
            <p v-if="timeline.generations.length === 0" class="coach-panel__note" v-i18n>No decisions recorded yet.</p>
            <section v-for="g in [...timeline.generations].reverse()" :key="g.generation" class="coach-timeline" data-test="timeline-generation">
              <h3 class="coach-choices__title">{{ show({template: 'Generation ${0}', params: [{text: String(g.generation)}]}) }}</h3>
              <ol class="coach-timeline__events">
                <li v-for="e in g.events" :key="e.id" class="coach-timeline__event" :class="'coach-timeline__event--' + e.kind" data-test="timeline-event">
                  <span v-if="e.order !== undefined" class="coach-timeline__order">{{ e.order }}</span>
                  <span>{{ eventLines(e).map(show).join(' · ') }}</span>
                  <span v-if="!e.verified" class="coach-plan__badge" v-i18n>Not confirmed by the game state</span>
                  <span v-if="listedCards(e).length > 0" class="coach-timeline__cards">{{ listedCards(e).map((n) => $t(n)).join(', ') }}</span>
                </li>
              </ol>
            </section>
            <template v-if="timeline.superseded.length > 0">
              <button type="button" class="coach-panel__link" data-test="timeline-undone" @click="showUndone = !showUndone">{{ showUndone ? $t('Hide undone actions') : show({template: 'Show undone actions (${0})', params: [{text: String(timeline.superseded.length)}]}) }}</button>
              <ol v-if="showUndone" class="coach-timeline__events coach-timeline__events--undone">
                <li v-for="e in timeline.superseded" :key="e.id" class="coach-timeline__event">{{ show({template: 'Generation ${0}', params: [{text: String(e.generation)}]}) }}: {{ eventLines(e).map(show).join(' · ') }}</li>
              </ol>
            </template>
            <p v-if="timeline.truncated" class="coach-panel__note" v-i18n>Only the start of a long history is shown.</p>
          </template>
        </template>
      </template>

      <p v-else-if="loading && options === undefined" class="coach-panel__note" v-i18n>Loading the analysis</p>
      <p v-else-if="failed" class="coach-panel__note" data-test="error" v-i18n>The coach is not available right now.</p>

      <!-- The selected option and its review -->
      <template v-else-if="options !== undefined && selected !== undefined && !picking">
        <p class="coach-choice__selected"><span v-i18n>Selected</span>: <strong>{{ optionText(selected) }}</strong></p>
        <p v-if="compared !== undefined" class="coach-choice__selected"><span v-i18n>Compared with</span>: <strong>{{ optionText(compared) }}</strong></p>
        <label v-if="options.ai.available" class="coach-choice__consent">
          <input type="checkbox" v-model="aiConsent" data-test="consent">
          <span v-i18n>Use the external AI (sends this position without ids)</span>
        </label>
        <div class="coach-choice__actions">
          <button type="button" class="coach-panel__button coach-panel__button--primary" data-test="review" :disabled="reviewing" @click="review" v-i18n>Review this choice</button>
          <button type="button" class="coach-panel__button" data-test="compare" :disabled="reviewing" @click="picking = true" v-i18n>Compare with another</button>
          <button type="button" class="coach-panel__button" data-test="choose-again" @click="chooseAgain" v-i18n>Choose again</button>
        </div>
        <p v-if="reviewing" class="coach-panel__note" v-i18n>Reviewing</p>
        <p v-if="counselError" class="coach-panel__note" data-test="counsel-error" v-i18n>The coach is not available right now.</p>

        <template v-if="counsel !== undefined">
          <p v-if="counselStale" class="coach-panel__warning" data-test="stale" v-i18n>The game has moved on: this review is for an earlier position.</p>
          <template v-else>
            <p v-if="counsel.status === 'fallback'" class="coach-panel__note" data-test="fallback" v-i18n>The AI answer could not be used; the review comes from the game data.</p>
            <p v-else-if="counsel.source === 'model'" class="coach-panel__note" v-i18n>Review written by AI from the facts below.</p>
            <p v-else-if="counsel.source === 'template'" class="coach-panel__note" v-i18n>Review from the game data (AI not used).</p>
            <section v-for="section in sections" :key="section.title" class="coach-review" :data-test="'review-' + section.key">
              <h3 class="coach-review__title">{{ $t(section.title) }}</h3>
              <ul class="coach-review__points">
                <li v-for="(p, i) in section.points" :key="i" class="coach-review__point">
                  <span v-if="compared !== undefined" class="coach-review__about">{{ p.about }}</span>
                  {{ pointText(p) }}
                  <span v-if="p.support !== 'verified'" class="coach-plan__badge">{{ $t(p.support === 'conditional' ? 'Based on assumptions' : 'Not known') }}</span>
                  <span class="coach-review__evidence">{{ p.evidenceIds.join(' ') }}</span>
                </li>
              </ul>
            </section>
          </template>
        </template>

        <button v-if="counsel !== undefined && counsel.facts.length > 0" type="button" class="coach-panel__link" data-test="evidence" @click="showEvidence = !showEvidence">{{ $t(showEvidence ? 'Hide evidence' : 'Show evidence') }}</button>
        <ul v-if="counsel !== undefined && showEvidence" class="coach-facts" data-test="facts">
          <li v-for="fact in counsel.facts" :key="fact.id" class="coach-facts__fact">
            <span class="coach-review__evidence">{{ fact.id }}<template v-if="compared !== undefined && fact.about !== 'game'"> {{ fact.about }}</template></span>
            <span v-for="(line, i) in factLines(fact)" :key="i" class="coach-facts__line">{{ show(line) }}</span>
          </li>
        </ul>
      </template>

      <!-- The options -->
      <template v-else-if="options !== undefined">
        <p v-if="picking" class="coach-panel__warning" data-test="picking">
          <span v-i18n>Choose an option to compare</span>
          <button type="button" class="coach-panel__link" @click="picking = false" v-i18n>Cancel</button>
        </p>
        <p v-if="statusNote !== undefined" class="coach-panel__note" data-test="status">{{ $t(statusNote) }}</p>
        <section v-for="group in groups" :key="group.key" class="coach-choices" :data-test="'group-' + group.key">
          <h3 class="coach-choices__title">{{ $t(group.title) }}</h3>
          <ul class="coach-choices__list">
            <li v-for="option in group.options" :key="option.id">
              <button type="button" class="coach-choice" :class="{'coach-choice--off': !option.selectableForCoaching}"
                :disabled="!option.selectableForCoaching || option.id === selectedId" data-test="option" @click="pick(option)">
                <span class="coach-choice__label">
                  <span v-if="option.planGoal !== undefined" class="coach-choice__goal">{{ $t(goalLabel(option.planGoal)) }}</span>
                  {{ optionText(option) }}
                </span>
                <span class="coach-choice__meta">
                  <span v-if="option.cost !== undefined">{{ show({template: 'Cost: ${0} M€', params: [{text: String(option.cost)}]}) }}</span>
                  <span :class="'coach-plan__availability coach-plan__availability--' + option.eligibility">{{ $t(eligibilityLabel(option.eligibility)) }}</span>
                  <span v-for="code in option.limitations" :key="code" class="coach-choice__limit">{{ $t(limitationLabel(code)) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
        <p v-for="o in options.omitted" :key="o.reason" class="coach-panel__note">{{ show({template: '${0} standard projects cannot be done now', params: [{text: String(o.count)}]}) }}</p>
        <p class="coach-panel__note" v-i18n>Choosing here does not play anything. You play in the game as usual.</p>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {ViewModel} from '@/common/models/PlayerModel';
import {translateText, translateTextWithParams} from '@/client/directives/i18n';
import {CoachChoiceListV1, CoachChoiceOption, CoachLabel} from '../common/CoachChoiceList';
import {CoachCounselRequest, CoachCounselV1, CoachPoint} from '../common/CoachCounsel';
import {DisplayLine, goalLabel} from '../common/coachText';
import {eligibilityLabel, factLines, limitationLabel} from './choiceText';
import {eventLines, listedCards, timelineStatusNote, victoryLine} from './timelineText';
import {CoachTimelineV1} from '../common/CoachTimeline';
import {coachPanelState} from './coachPanelState';
import {getPreferences} from '@/client/utils/PreferencesManager';

const props = defineProps<{view: ViewModel | undefined}>();

const state = coachPanelState;
const options = ref<CoachChoiceListV1 | undefined>(undefined);
const loading = ref(false);
const failed = ref(false);
const selectedId = ref<string | undefined>(undefined);
const comparedId = ref<string | undefined>(undefined);
const picking = ref(false);
const counsel = ref<CoachCounselV1 | undefined>(undefined);
const reviewing = ref(false);
const counselError = ref(false);
const showEvidence = ref(false);
const aiConsent = ref(readConsent());
let inFlight: AbortController | undefined;
const tab = ref<'choices' | 'timeline'>('choices');
const timeline = ref<CoachTimelineV1 | undefined>(undefined);
const timelineFailed = ref(false);
const showUndone = ref(false);
let timelineRequest = 0;

/* The timeline is for solo games (the server says `not-solo` too). */
const solo = computed(() => (props.view?.players?.length ?? 1) === 1);

/* Only the answer of the latest options request is shown (an older one may arrive later). */
let optionsRequest = 0;
let optionsInFlight: AbortController | undefined;

/* The coach works for the player of a player page only (not for spectators). */
const playerId = computed(() => {
  const view = props.view;
  return view !== undefined && view.thisPlayer !== undefined && typeof view.id === 'string' && view.id.startsWith('p') ? view.id : undefined;
});

/* Changes when the game moves on (a move, an undo, another player's action). */
const position = computed(() => {
  const game = props.view?.game;
  return game === undefined ? '' : `${game.gameAge}:${game.undoCount}:${game.step}:${game.phase}`;
});

const selected = computed(() => options.value?.options.find((o) => o.id === selectedId.value));
const compared = computed(() => options.value?.options.find((o) => o.id === comparedId.value));
/* A review made for another position than the one shown now. */
const counselStale = computed(() => counsel.value !== undefined && (counsel.value.status === 'stale' || counsel.value.positionToken !== options.value?.positionToken));

const groups = computed(() => {
  const all = options.value?.options ?? [];
  return [
    {key: 'now', title: 'Now: what you can do', options: all.filter((o) => o.group === 'now')},
    {key: 'future', title: 'Future: plans to look ahead', options: all.filter((o) => o.group === 'future')},
  ].filter((g) => g.options.length > 0);
});

const statusNote = computed(() => {
  switch (options.value?.stateStatus) {
  case 'waiting-for-others': return 'Other players are acting: nothing to choose right now.';
  case 'resolving': return 'The game is resolving automatic steps.';
  case 'game-over': return 'The game is over.';
  default: return undefined;
  }
});

const sections = computed(() => {
  const c = counsel.value;
  if (c === undefined) {
    return [];
  }
  return [
    {key: 'strengths', title: 'Strengths', points: c.strengths},
    {key: 'risks', title: 'Cautions', points: c.risks},
    {key: 'outlook', title: 'Outlook', points: c.outlook},
    {key: 'question', title: 'Question', points: c.question === undefined ? [] : [c.question]},
  ].filter((s) => s.points.length > 0);
});

function readConsent(): boolean {
  try {
    return localStorage.getItem('coach.aiConsent') === '1';
  } catch {
    return false;
  }
}

watch(aiConsent, (value) => {
  try {
    localStorage.setItem('coach.aiConsent', value ? '1' : '0');
  } catch {
    // The consent then only lasts for this page.
  }
});

function show(line: DisplayLine | CoachLabel): string {
  return translateTextWithParams(line.template, line.params.map((p) => (p.card ? translateText(p.text) : p.text)));
}

function optionText(option: CoachChoiceOption): string {
  // Plans are shown card by card, so that each name is translated.
  const text = option.kind === 'strategy-plan' ? option.cardNames.map((n) => translateText(n)).join(' → ') : show(option.label);
  return option.parentLabel === undefined ? text : `${show(option.parentLabel)}: ${text}`;
}

function pointText(p: CoachPoint): string {
  return p.text ?? (p.template === undefined ? '' : show(p.template));
}

function abort() {
  inFlight?.abort();
  inFlight = undefined;
  reviewing.value = false;
}

async function loadOptions(): Promise<void> {
  const id = playerId.value;
  if (id === undefined) {
    return;
  }
  const request = ++optionsRequest;
  optionsInFlight?.abort();
  const controller = new AbortController();
  optionsInFlight = controller;
  loading.value = true;
  try {
    const response = await fetch(`api/coach/options?id=${encodeURIComponent(id)}`, {cache: 'no-store', signal: controller.signal});
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const list = await response.json() as CoachChoiceListV1;
    if (request !== optionsRequest) {
      return;
    }
    options.value = list;
    failed.value = false;
    // A choice of an earlier position no longer exists: back to the list (the old review stays marked stale).
    if (selectedId.value !== undefined && selected.value === undefined) {
      abort();
      selectedId.value = undefined;
      comparedId.value = undefined;
      picking.value = false;
    }
  } catch (error) {
    if (request === optionsRequest && !(error instanceof DOMException && error.name === 'AbortError')) {
      failed.value = true;
    }
  } finally {
    if (request === optionsRequest) {
      loading.value = false;
      optionsInFlight = undefined;
    }
  }
}

async function loadTimeline(): Promise<void> {
  const id = playerId.value;
  if (id === undefined) {
    return;
  }
  const request = ++timelineRequest;
  try {
    const response = await fetch(`api/coach/timeline?id=${encodeURIComponent(id)}`, {cache: 'no-store'});
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const body = await response.json() as CoachTimelineV1;
    if (request === timelineRequest) {
      timeline.value = body;
      timelineFailed.value = false;
    }
  } catch {
    if (request === timelineRequest) {
      timelineFailed.value = true;
    }
  }
}

function refresh() {
  if (tab.value === 'timeline') {
    void loadTimeline();
  } else {
    void loadOptions();
  }
}

async function ask(mode: CoachCounselRequest['mode']): Promise<void> {
  const id = playerId.value;
  const list = options.value;
  if (id === undefined || list === undefined || selectedId.value === undefined) {
    return;
  }
  abort();
  const controller = new AbortController();
  inFlight = controller;
  reviewing.value = mode === 'review';
  counselError.value = false;
  const body: CoachCounselRequest = {
    schemaVersion: 'coach-counsel-request/1', positionToken: list.positionToken, choiceId: selectedId.value,
    compareWithChoiceId: comparedId.value ?? null, mode, language: getPreferences().lang, aiConsent: aiConsent.value,
  };
  try {
    const response = await fetch(`api/coach/counsel?id=${encodeURIComponent(id)}`, {
      method: 'POST', cache: 'no-store', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: controller.signal,
    });
    if (response.status === 409) {
      // The position changed: show the new options instead.
      await loadOptions();
      return;
    }
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    const result = await response.json() as CoachCounselV1;
    if (inFlight === controller) {
      counsel.value = result;
      if (mode === 'review') {
        showEvidence.value = false;
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      counselError.value = true;
    }
  } finally {
    if (inFlight === controller) {
      inFlight = undefined;
      reviewing.value = false;
    }
  }
}

function pick(option: CoachChoiceOption) {
  if (picking.value) {
    comparedId.value = option.id;
    picking.value = false;
  } else {
    selectedId.value = option.id;
    comparedId.value = undefined;
  }
  counsel.value = undefined;
  // The facts are shown at once; after a review they fold away behind "Show evidence".
  showEvidence.value = true;
  void ask('facts');
}

function review() {
  void ask('review');
}

function chooseAgain() {
  abort();
  selectedId.value = undefined;
  comparedId.value = undefined;
  picking.value = false;
  counsel.value = undefined;
}

function close() {
  abort();
  state.open = false;
}

watch(() => [state.open, position.value, playerId.value], () => {
  if (state.open) {
    void loadOptions();
    if (tab.value === 'timeline') {
      void loadTimeline();
    }
  } else {
    abort();
  }
}, {immediate: true});

watch(tab, (value) => {
  if (value === 'timeline' && state.open) {
    void loadTimeline();
  }
});
</script>

<style scoped lang="less">
.coach-panel {
  position: fixed;
  /* The game screen is one stacking context (mb-home, z-index 0): the coach is above all of it, so it
     stays out of the way of the game's own sheets (from the bottom) and bars instead. */
  z-index: 25;
  display: flex;
  flex-direction: column;
  background: #12161e;
  color: #eee;
  box-shadow: 0 0 16px rgba(0, 0, 0, 0.6);
  font-size: 14px;
  /* Portrait: a drawer under the top bar (@mb-top-height in mobile.less); the action sheet and the
     bottom navigation stay usable, the board can be seen between them. */
  left: 0;
  right: 0;
  top: calc(52px + env(safe-area-inset-top));
  max-height: 40vh;
  border-radius: 0 0 12px 12px;
}
/* Same breakpoint as @mb-landscape in mobile.less. */
@media (min-width: 900px) and (orientation: landscape) {
  /* Landscape: in the upper right corner, the action sheet and the navigation stay usable below it. */
  .coach-panel {
    left: auto;
    max-height: 45vh;
    width: min(440px, 45vw);
    border-radius: 0 0 0 12px;
  }
}
.coach-panel__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.coach-panel__tabs {
  display: flex;
  gap: 4px;
}
.coach-panel__tab {
  min-height: 36px;
  padding: 4px 8px;
  opacity: 0.7;
}
.coach-panel__tab[aria-selected="true"] {
  opacity: 1;
  font-weight: bold;
  border-bottom: 2px solid #8fc3ff;
}
.coach-timeline__events {
  margin: 0;
  padding: 0;
  list-style: none;
}
.coach-timeline__event {
  margin: 3px 0;
  font-size: 13px;
}
.coach-timeline__order {
  display: inline-block;
  min-width: 18px;
  margin-right: 4px;
  font-size: 11px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 9px;
}
.coach-timeline__cards {
  display: block;
  margin-left: 22px;
  font-size: 12px;
  opacity: 0.85;
}
.coach-timeline__events--undone {
  opacity: 0.6;
  text-decoration: line-through;
}
.coach-panel__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
}
.coach-panel__button {
  min-height: 36px;
  padding: 4px 10px;
}
.coach-panel__button--primary {
  font-weight: bold;
}
.coach-panel__link {
  background: none;
  border: none;
  color: #8fc3ff;
  padding: 4px 0;
  text-decoration: underline;
}
.coach-panel__body {
  overflow-y: auto;
  padding: 8px 12px 16px;
  -webkit-overflow-scrolling: touch;
}
.coach-panel__note {
  opacity: 0.8;
  font-size: 13px;
}
.coach-panel__warning {
  color: #f5c76a;
  font-size: 13px;
}
.coach-choices__title,
.coach-review__title {
  margin: 10px 0 4px;
  font-size: 14px;
}
.coach-choices__list,
.coach-review__points,
.coach-facts {
  margin: 0;
  padding: 0;
  list-style: none;
}
.coach-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 40px;
  margin: 3px 0;
  padding: 6px 8px;
  text-align: left;
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
}
.coach-choice--off {
  opacity: 0.6;
}
.coach-choice__goal {
  margin-right: 4px;
  font-weight: bold;
}
.coach-choice__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  opacity: 0.85;
}
.coach-choice__limit {
  color: #c9c9c9;
}
.coach-choice__selected {
  margin: 4px 0;
}
.coach-choice__consent {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
  font-size: 13px;
}
.coach-choice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0;
}
.coach-plan__badge {
  margin-left: 4px;
  font-size: 12px;
  color: #f5c76a;
}
.coach-plan__availability--legal-now {
  color: #7fd47f;
}
.coach-review__point,
.coach-facts__fact {
  margin: 3px 0;
  font-size: 13px;
}
.coach-review__about {
  margin-right: 4px;
  font-weight: bold;
}
.coach-review__evidence {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.7;
}
.coach-facts__line {
  display: block;
  margin-left: 12px;
}
</style>
