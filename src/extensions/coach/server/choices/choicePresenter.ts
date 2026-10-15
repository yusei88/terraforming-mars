import {createHash} from 'crypto';
import {IPlayer} from '@/server/IPlayer';
import {PlayerInput} from '@/server/PlayerInput';
import {Message} from '@/common/logs/Message';
import {LogMessageDataType} from '@/common/logs/LogMessageDataType';
import {OrOptions} from '@/server/inputs/OrOptions';
import {AndOptions} from '@/server/inputs/AndOptions';
import {SelectInitialCards} from '@/server/inputs/SelectInitialCards';
import {SelectOption} from '@/server/inputs/SelectOption';
import {UndoActionOption} from '@/server/inputs/UndoActionOption';
import {SelectProjectCardToPlay} from '@/server/inputs/SelectProjectCardToPlay';
import {SelectStandardProjectToPlay} from '@/server/inputs/SelectStandardProjectToPlay';
import {SelectCard} from '@/server/inputs/SelectCard';
import {CoachChoice, CoachStateV1} from '../../common/CoachState';
import {CandidatePlan, CoachAnalysisV1} from '../../common/CoachAnalysis';
import {COACH_CHOICE_LIST_SCHEMA, CoachChoiceKind, CoachChoiceListV1, CoachChoiceOption, CoachLabel} from '../../common/CoachChoiceList';

// Builds the options the player can have coached (docs/coach/phase3/choice-driven-design.md §3–4).
//
// "Now" comes from the input the game is waiting for, read through its classes, because the normalized
// CoachChoices cannot tell a standard project from a project card or an undo from a pass. Values (costs,
// disabled projects) come from CoachChoices, which has the same indexes. Only inputs whose meaning was
// checked in the game code become single moves; everything else is listed as one entry that cannot be
// coached yet. "Future" holds the analysis plans. Nothing here changes the game.

/** One option with what the server needs to coach it (kept on the server). */
export type ChoiceEntry = {
  option: CoachChoiceOption,
  /** Path of the input in the game's tree (CoachChoice.path). */
  path: string,
  cardName?: string,
  plan?: CandidatePlan,
  /** Plain English text of the option (for the model). */
  text: string,
};

export type BuiltChoiceList = {
  list: CoachChoiceListV1,
  entries: ReadonlyMap<string, ChoiceEntry>,
};

function sha(text: string, length: number): string {
  return createHash('sha256').update(text).digest('hex').slice(0, length);
}

/** Token of the position seen by this viewer: content, undo, step, advice inputs and versions. */
export function positionToken(state: CoachStateV1, analysis: CoachAnalysisV1, viewer: string): string {
  return sha([sha(viewer, 16), state.stateKey, state.advisoryFingerprint, analysis.source.analysisVersion, COACH_CHOICE_LIST_SCHEMA].join('|'), 32);
}

function label(title: string | Message): CoachLabel {
  if (typeof title === 'string') {
    return {template: title, params: []};
  }
  return {
    template: title.message,
    params: title.data.map((d) => ({text: Array.isArray(d.value) ? d.value.join(', ') : String(d.value), ...(d.type === LogMessageDataType.CARD ? {card: true} : {})})),
  };
}

function plainText(l: CoachLabel): string {
  return l.template.replace(/\$\{(\d+)\}/g, (_, i) => l.params[Number(i)]?.text ?? '');
}

function cardLabel(name: string): CoachLabel {
  return {template: '${0}', params: [{text: name, card: true}]};
}

function child(path: string, index: number): string {
  return path === '' ? String(index) : `${path}.${index}`;
}

class Builder {
  public readonly entries: Array<Omit<ChoiceEntry, 'option'> & {option: Omit<CoachChoiceOption, 'id'>}> = [];
  public readonly omitted = new Map<string, number>();

  public add(kind: CoachChoiceKind, group: 'now' | 'future', path: string, l: CoachLabel, extra: Partial<CoachChoiceOption> & {cardName?: string, plan?: CandidatePlan} = {}) {
    const {cardName, plan, ...rest} = extra;
    const selectable = ['project-card', 'standard-project', 'game-option', 'strategy-plan'].includes(kind);
    this.entries.push({
      path, cardName, plan, text: plainText(l),
      option: {
        group, kind, label: l, cardNames: cardName === undefined ? [] : [cardName],
        eligibility: 'legal-now', selectableForCoaching: selectable, limitations: [],
        ...rest,
      },
    });
  }

  public omit(reason: string) {
    this.omitted.set(reason, (this.omitted.get(reason) ?? 0) + 1);
  }

  public walk(input: PlayerInput, path: string, coach: CoachChoice | undefined, parent: CoachLabel | undefined): void {
    const nested = parent === undefined ? {} : {parentLabel: parent};
    if (input instanceof OrOptions) {
      // One branch of an `or` is chosen. Branches of a nested `or` keep its title as context.
      const own = path === '' ? undefined : label(input.title);
      input.options.forEach((option, i) => this.walk(option, child(path, i), coach?.options?.[i], own ?? parent));
    } else if (input instanceof AndOptions || input instanceof SelectInitialCards) {
      const title = label(input.title);
      this.add('compound-input', 'now', path, title.template.trim() === '' ? {template: 'Choices at the start of the game', params: []} : title, {...nested, eligibility: 'not-action', limitations: ['compound-input']});
    } else if (input instanceof UndoActionOption) {
      this.add('undo', 'now', path, label(input.title), {...nested, limitations: ['undo']});
    } else if (input instanceof SelectOption) {
      this.add('game-option', 'now', path, label(input.title), {...nested, limitations: ['no-quantitative-analysis']});
    } else if (input instanceof SelectStandardProjectToPlay) {
      input.cards.forEach((card, i) => {
        const instance = coach?.cards?.[i];
        if (instance === undefined || instance.isDisabled === true) {
          this.omit('standard-project-not-available');
          return;
        }
        this.add('standard-project', 'now', path, cardLabel(card.name), {...nested, cardName: card.name, cost: instance.calculatedCost, limitations: ['no-quantitative-analysis']});
      });
    } else if (input instanceof SelectProjectCardToPlay) {
      // Cards that passed the game's canPlay: each one is a move (the payment is chosen when playing).
      input.cards.forEach((card, i) => {
        this.add('project-card', 'now', path, cardLabel(card.name), {...nested, cardName: card.name, cost: coach?.cards?.[i]?.calculatedCost});
      });
    } else if (input instanceof SelectCard) {
      if (coach?.selectBlueCardAction === true) {
        input.cards.forEach((card) => this.add('blue-action', 'now', path, cardLabel(card.name), {...nested, cardName: card.name, limitations: ['kind-not-supported-yet']}));
      } else {
        // Buying, selling, picking: a selection of cards, not a move per card.
        this.add('card-selection', 'now', path, label(input.title), {
          ...nested, cardNames: input.cards.map((c) => c.name), eligibility: 'not-action', limitations: ['card-selection'],
        });
      }
    } else {
      this.add('input-not-analysed', 'now', path, label(input.title), {...nested, eligibility: 'not-action', limitations: ['input-not-analysed']});
    }
  }
}

function planOption(plan: CandidatePlan, analysis: CoachAnalysisV1): Partial<CoachChoiceOption> {
  const limitations: Array<string> = [];
  const single = plan.cards.length === 1;
  if (!single) {
    limitations.push('plan-not-one-move');
  }
  if (plan.support.level !== 'verified') {
    limitations.push('based-on-assumptions');
  }
  if (plan.forecast !== undefined && !plan.forecast.complete) {
    limitations.push('forecast-incomplete');
  }
  if (analysis.search.truncated) {
    limitations.push('search-truncated');
  }
  const eligibility = plan.cards.some((c) => c.availability === 'unknown') ? 'unknown' :
    single && plan.cards[0].availability === 'legal-now' ? 'legal-now' : 'conditional';
  return {
    cardNames: plan.cards.map((c) => c.name), planGoal: plan.goal, eligibility, limitations,
    ...(typeof plan.payments.play === 'number' ? {cost: plan.payments.play + plan.payments.purchase} : {}),
  };
}

/** The options of the player's current position. `viewer` is the player id (hashed into the token only). */
export function buildChoiceList(player: IPlayer, state: CoachStateV1, analysis: CoachAnalysisV1, viewer: string, aiAvailable: boolean): BuiltChoiceList {
  const token = positionToken(state, analysis, viewer);
  const builder = new Builder();
  const waitingFor = player.getWaitingFor();
  if (state.choices.status === 'awaiting-input' && waitingFor !== undefined) {
    builder.walk(waitingFor, '', state.choices.root, undefined);
  }
  if (state.choices.status !== 'game-over') {
    analysis.candidates.forEach((plan, i) => {
      const l: CoachLabel = {template: plan.cards.map((_, j) => `\${${j}}`).join(' → '), params: plan.cards.map((c) => ({text: c.name, card: true}))};
      builder.add('strategy-plan', 'future', `plan:${i}`, l, {...planOption(plan, analysis), plan});
    });
  }
  const entries = new Map<string, ChoiceEntry>();
  const options: Array<CoachChoiceOption> = [];
  for (const e of builder.entries) {
    let id = sha([token, e.option.kind, e.path, e.cardName ?? '', e.plan?.id ?? ''].join('|'), 16);
    // Two identical entries (the same card twice in a list) still get distinct ids.
    while (entries.has(id)) {
      id = sha(id, 16);
    }
    const option: CoachChoiceOption = {id, ...e.option};
    options.push(option);
    entries.set(id, {...e, option});
  }
  return {
    list: {
      schemaVersion: COACH_CHOICE_LIST_SCHEMA,
      positionToken: token,
      analysisVersion: analysis.source.analysisVersion,
      stateStatus: state.choices.status,
      options,
      omitted: [...builder.omitted].map(([reason, count]) => ({reason, count})),
      ai: {available: aiAvailable},
      warnings: analysis.search.truncated ? ['search-truncated'] : [],
    },
    entries,
  };
}
