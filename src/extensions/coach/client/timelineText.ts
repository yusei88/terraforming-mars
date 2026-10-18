import {CoachTimelineV1, TimelineEvent} from '../common/CoachTimeline';
import {DisplayLine} from '../common/coachText';

// Display of the solo timeline (P3-SOLO-1) as fixed English templates (translated in
// src/extensions/coach/locales). Card names are translated with the game's card texts.

const card = (name: string) => ({text: name, card: true});
const value = (n: number | string) => ({text: String(n)});

/** What one event says, as lines. */
export function eventLines(e: TimelineEvent): Array<DisplayLine> {
  switch (e.kind) {
  case 'buy-cards':
    return [e.cards.length === 0 ? {template: 'Bought no cards', params: []} : {template: 'Bought ${0} cards', params: [value(e.cards.length)]}];
  case 'initial-selection':
    return [
      ...(e.chosen ?? []).map((name) => ({template: 'Chose ${0}', params: [card(name)]})),
      e.cards.length === 0 ? {template: 'Bought no cards', params: []} : {template: 'Bought ${0} cards', params: [value(e.cards.length)]},
    ];
  case 'play-card':
    return [e.cost === undefined ?
      {template: 'Played ${0}', params: [card(e.cards[0] ?? '')]} :
      {template: 'Played ${0} for ${1} M€', params: [card(e.cards[0] ?? ''), value(e.cost)]}];
  case 'standard-project':
    return [{template: 'Standard project: ${0}', params: [card(e.cards[0] ?? '')]}];
  case 'card-action':
    return [{template: 'Used the action of ${0}', params: [card(e.cards[0] ?? '')]}];
  case 'sell-patents':
    return [{template: 'Sold ${0} cards', params: [value(e.cards.length)]}];
  case 'pass':
    return [{template: 'Passed', params: []}];
  case 'end-turn':
    return [{template: 'Ended the turn', params: []}];
  case 'undo':
    return [{template: 'Undo', params: []}];
  case 'cancel-action':
    return [{template: 'Action cancelled', params: []}];
  case 'game-option':
  case 'other':
  case 'follow-up':
    // The game's own title of the option (translated by the game's texts).
    return [{template: '${0}', params: [card(e.label ?? '')]}];
  }
}

/** Card names listed under a purchase or a sale. */
export function listedCards(e: TimelineEvent): ReadonlyArray<string> {
  return e.kind === 'buy-cards' || e.kind === 'initial-selection' || e.kind === 'sell-patents' ? e.cards : [];
}

/** Why there is nothing to show, or undefined when the timeline is there. */
export function timelineStatusNote(t: CoachTimelineV1): string | undefined {
  switch (t.status) {
  case 'disabled': return 'History is off on this server (COACH_TRACE_DIR is not set).';
  case 'unreadable': return 'The history could not be read.';
  case 'not-solo': return 'The timeline is only for solo games.';
  case 'ok': return undefined;
  }
}

export function victoryLine(t: CoachTimelineV1): DisplayLine | undefined {
  if (t.solo === undefined) {
    return undefined;
  }
  return t.solo.victory === 'tr63' ?
    {template: 'Victory: reach a TR of 63 by generation ${0}', params: [value(t.solo.lastGeneration)]} :
    {template: 'Victory: terraform Mars by generation ${0}', params: [value(t.solo.lastGeneration)]};
}
