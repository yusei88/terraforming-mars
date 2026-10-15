<!-- Strategy coach (Phase 2): a drawer with the candidate plans of GET api/coach/analysis for the player
     of this page. Read-only and closable at any time; it opens under the top bar (full width in portrait, in the
     upper right corner in landscape), so the board, the action sheet and the navigation stay usable. Refreshes when the game moves on. -->
<template>
  <aside v-if="state.open" class="coach-panel" role="dialog" :aria-label="$t('Strategy coach')">
    <header class="coach-panel__header">
      <h2 class="coach-panel__title" v-i18n>Strategy coach</h2>
      <label class="coach-panel__horizon">
        <span v-i18n>Production phases</span>
        <select v-model.number="horizon" data-test="horizon">
          <option v-for="h in [0, 1, 2, 3]" :key="h" :value="h">{{ h }}</option>
        </select>
      </label>
      <button type="button" class="coach-panel__button" data-test="refresh" @click="load" v-i18n>Refresh</button>
      <button type="button" class="coach-panel__button" data-test="close" @click="state.open = false" v-i18n>Close</button>
    </header>

    <div class="coach-panel__body">
      <p v-if="playerId === undefined" class="coach-panel__note" v-i18n>The coach is only for players.</p>
      <p v-else-if="loading && analysis === undefined" class="coach-panel__note" v-i18n>Loading the analysis</p>
      <p v-else-if="failed" class="coach-panel__note" data-test="error" v-i18n>The coach is not available right now.</p>
      <template v-else-if="analysis !== undefined">
        <p v-if="analysis.candidates.length === 0" class="coach-panel__note" v-i18n>No plans for your cards right now.</p>
        <article v-for="plan in analysis.candidates" :key="plan.id" class="coach-plan" data-test="plan">
          <div class="coach-plan__head">
            <span class="coach-plan__goal">{{ $t(goalLabel(plan.goal)) }}</span>
            <span v-if="conditional(plan)" class="coach-plan__badge" v-i18n>Based on assumptions</span>
          </div>
          <ol class="coach-plan__cards">
            <li v-for="card in plan.cards" :key="card.name" class="coach-plan__card">
              <span class="coach-plan__card-name">{{ $t(card.name) }}</span>
              <span :class="['coach-plan__availability', 'coach-plan__availability--' + card.availability]">{{ $t(availabilityLabel(card.availability)) }}</span>
            </li>
          </ol>
          <ul class="coach-plan__lines">
            <li v-for="(line, i) in plan.links.map(linkLine)" :key="'l' + i">{{ show(line) }}</li>
            <li v-for="(line, i) in plan.blockers.map(blockerLine)" :key="'b' + i" class="coach-plan__blocker">{{ show(line) }}</li>
          </ul>
          <template v-if="plan.forecast !== undefined">
            <table class="coach-plan__forecast">
              <thead>
                <tr>
                  <th></th>
                  <th v-for="r in resources" :key="r"><i :class="['resource_icon', 'resource_icon--' + r, 'coach-plan__icon']"></i></th>
                  <th><i class="resource_icon resource_icon--rating coach-plan__icon"></i></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="delta in plan.forecast.deltas" :key="delta.productionIndex">
                  <th>{{ show(rowLabel(delta.productionIndex)) }}</th>
                  <td v-for="r in resources" :key="r">{{ signed(delta.resources[r]) }}</td>
                  <td>{{ signed(delta.terraformRating) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-for="(line, i) in forecastLines(plan.forecast)" :key="'f' + i" class="coach-plan__summary">{{ show(line) }}</p>
          </template>
          <p v-if="question(plan) !== ''" class="coach-plan__question" data-test="question">{{ question(plan) }}</p>
        </article>
        <p class="coach-panel__note">
          {{ show({template: '${0} of ${1} cards fully modeled', params: [{text: String(analysis.coverage.supported)}, {text: String(analysis.coverage.supported + analysis.coverage.partial + analysis.coverage.unsupported)}]}) }}
        </p>
        <p class="coach-panel__note" v-i18n>A missing link does not mean there is none: some effects are not modeled.</p>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {ViewModel} from '@/common/models/PlayerModel';
import {translateText, translateTextWithParams} from '@/client/directives/i18n';
import {CandidatePlan, CoachAnalysisV1} from '../common/CoachAnalysis';
import {coachPanelState} from './coachPanelState';
import {
  availabilityLabel, blockerLine, conditional, DisplayLine, forecastLines, goalLabel, linkLine, questionLine, rowLabel, signed,
} from './coachText';

const props = defineProps<{view: ViewModel | undefined}>();

const state = coachPanelState;
const resources = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'] as const;
const horizon = ref(3);
const analysis = ref<CoachAnalysisV1 | undefined>(undefined);
const loading = ref(false);
const failed = ref(false);

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

function show(line: DisplayLine): string {
  return translateTextWithParams(line.template, line.params.map((p) => (p.card ? translateText(p.text) : p.text)));
}

function question(plan: CandidatePlan): string {
  const line = questionLine(plan.question);
  return line === undefined ? '' : show(line);
}

async function load(): Promise<void> {
  const id = playerId.value;
  if (id === undefined) {
    return;
  }
  loading.value = true;
  try {
    const response = await fetch(`api/coach/analysis?id=${encodeURIComponent(id)}&horizon=${horizon.value}`, {cache: 'no-store'});
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    analysis.value = await response.json() as CoachAnalysisV1;
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

watch(() => [state.open, horizon.value, position.value, playerId.value], () => {
  if (state.open) {
    void load();
  }
}, {immediate: true});
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
.coach-panel__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
}
.coach-panel__horizon {
  display: flex;
  align-items: center;
  gap: 4px;
}
.coach-panel__button {
  min-height: 36px;
  padding: 4px 10px;
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
.coach-plan {
  margin: 8px 0 12px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
}
.coach-plan__head {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
}
.coach-plan__badge {
  font-weight: normal;
  font-size: 12px;
  color: #f5c76a;
}
.coach-plan__cards {
  margin: 6px 0;
  padding-left: 20px;
}
.coach-plan__card {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.coach-plan__availability {
  font-size: 12px;
  opacity: 0.85;
}
.coach-plan__availability--legal-now {
  color: #7fd47f;
  opacity: 1;
}
.coach-plan__lines {
  margin: 4px 0;
  padding-left: 18px;
  font-size: 13px;
}
.coach-plan__blocker {
  color: #f0a0a0;
}
.coach-plan__forecast {
  width: 100%;
  margin: 6px 0;
  border-collapse: collapse;
  font-size: 12px;
  text-align: right;
  th:first-child {
    text-align: left;
    font-weight: normal;
  }
}
.coach-plan__icon {
  display: inline-block;
  width: 18px;
  height: 18px;
}
.coach-plan__summary {
  margin: 2px 0;
  font-size: 13px;
}
.coach-plan__question {
  margin-top: 6px;
  font-style: italic;
}
</style>
