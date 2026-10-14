import {CoachCardInstance, CoachChoice, CoachStateV1} from '../../common/CoachState';
import {CardZone, Evidence, RequirementGap, Support, SynergyEdge, SynergyGraph, SynergyNode} from '../../common/CoachAnalysis';
import {CardMechanics, EffectAtom, RequirementSpec} from '../../common/CoachMechanics';
import {CoachCatalogCard} from '../../common/CoachCatalog';
import {CardName} from '@/common/cards/CardName';
import {CardType} from '@/common/cards/CardType';
import {Tag} from '@/common/cards/Tag';
import {Resource} from '@/common/Resource';
import {catalogCard} from '../cardCatalog';
import {mechanicsOf} from './mechanicsCatalog';
import {analyzeRequirements} from './requirements';
import {costAfterDiscount, discountOn} from './discounts';

// Directed relations between the cards a player has played, holds and is offered (Gate B). Every edge
// comes from an effect atom, a requirement or an engine rule, never from a shared tag alone. Relations
// that would need unmodeled effects are not produced and are listed in `notProduced` / `limitations`.
// Pure: reads only the snapshot and the catalog.

const PROJECT_TYPES: ReadonlySet<string> = new Set([CardType.AUTOMATED, CardType.ACTIVE, CardType.EVENT]);

type Card = {
  name: CardName,
  zone: CardZone,
  instance: CoachCardInstance,
  path: string,
  catalog: CoachCatalogCard | undefined,
  mechanics: CardMechanics | undefined,
};

function offeredCards(choice: CoachChoice | undefined, out: Array<{card: CoachCardInstance, path: string}>) {
  if (choice === undefined) {
    return;
  }
  if (choice.inputType === 'card') {
    (choice.cards ?? []).forEach((card, i) => out.push({card, path: `choices.root${choice.path === '' ? '' : '.' + choice.path}.cards[${i}]`}));
  }
  for (const option of choice.options ?? []) {
    offeredCards(option, out);
  }
}

/**
 * Cards of the graph: played > hand > offered when a name appears twice.
 *
 * With `maxUnplayed`, only that many unplayed cards are kept (hand before offer, then by name).
 */
function collectCards(state: CoachStateV1, maxUnplayed?: number): Array<Card> {
  const cards = new Map<CardName, Card>();
  const add = (instance: CoachCardInstance, zone: CardZone, path: string) => {
    if (!cards.has(instance.name)) {
      cards.set(instance.name, {name: instance.name, zone, instance, path, catalog: catalogCard(instance.name), mechanics: mechanicsOf(instance.name)});
    }
  };
  state.me.tableau.forEach((card, i) => add(card, 'played', `me.tableau[${i}]`));
  state.me.hand.forEach((card, i) => add(card, 'hand', `me.hand[${i}]`));
  state.me.preludesInHand.forEach((card, i) => add(card, 'hand', `me.preludesInHand[${i}]`));
  state.me.draftedCards.forEach((card, i) => add(card, 'offered', `me.draftedCards[${i}]`));
  const offered: Array<{card: CoachCardInstance, path: string}> = [];
  offeredCards(state.choices.status === 'awaiting-input' ? state.choices.root : undefined, offered);
  offered.forEach(({card, path}) => add(card, 'offered', path));
  const all = Array.from(cards.values());
  if (maxUnplayed === undefined) {
    return all;
  }
  const unplayed = all.filter((card) => card.zone !== 'played')
    .sort((a, b) => (a.zone === b.zone ? a.name.localeCompare(b.name) : a.zone === 'hand' ? -1 : 1))
    .slice(0, maxUnplayed);
  return [...all.filter((card) => card.zone === 'played'), ...unplayed];
}

function catalogEvidence(card: CardName, fieldPath: string): Evidence {
  return {kind: 'catalog', fieldPath, cardName: card};
}

function supportFor(gap: RequirementGap | undefined, evidence: Array<Evidence>, extra: Array<string> = []): Support {
  const assumptions = [...(gap?.assumptions ?? []), ...extra];
  return assumptions.length > 0 ? {level: 'conditional', assumptions, evidence} : {level: 'verified', evidence};
}

/* Assumption added when an edge relies on an effect atom of a card that also has unmodeled effects. */
function partialNote(a: Card): Array<string> {
  return a.mechanics?.support === 'supported' ? [] : [`${a.name} has other effects that are not modeled; this effect is read from its card definition`];
}

/* True when the card's blue card action is fully modeled (no unmodeled part). */
function actionModeled(card: Card): boolean {
  return card.mechanics !== undefined && !card.mechanics.unmodeled.some((u) => u.source === 'action');
}

function count<T>(items: ReadonlyArray<T>, item: T): number {
  return items.filter((i) => i === item).length;
}

/* Tags a played card adds to the counts the requirement uses (events keep no tags once played). */
function tagsAdded(a: Card, tag: Tag, includeWild: boolean): number {
  if (a.catalog === undefined || a.catalog.type === CardType.EVENT) {
    return 0;
  }
  return count(a.catalog.tags, tag) + (includeWild && tag !== Tag.WILD ? count(a.catalog.tags, Tag.WILD) : 0);
}

function onPlayAtoms(a: Card): ReadonlyArray<EffectAtom> {
  return a.mechanics?.atoms.filter((atom) => atom.source === 'onPlay') ?? [];
}

function globalSteps(state: CoachStateV1, a: Card, parameter: 'temperature' | 'oxygen'): number {
  const steps = onPlayAtoms(a).reduce((n, atom) => n + (atom.kind === 'global' && atom.parameter === parameter ? atom.steps : 0), 0);
  return Math.min(steps, state.game[parameter].stepsRemaining);
}

function productionChange(a: Card, resource: Resource): number {
  return onPlayAtoms(a).reduce((n, atom) => n + (atom.kind === 'production' && atom.resource === resource ? atom.amount : 0), 0);
}

/** UNLOCKS (minimum requirements) and CONFLICTS_WITH (maximum requirements, lost production) from A to B. */
function requirementEdges(state: CoachStateV1, a: Card, b: Card, gaps: ReadonlyArray<RequirementGap>, edges: Array<SynergyEdge>) {
  b.mechanics?.requirements.forEach((spec: RequirementSpec, index) => {
    const gap = gaps[index];
    if (gap === undefined || gap.status === 'unsupported' || typeof gap.observed !== 'number' || typeof gap.target !== 'number' || typeof gap.gap !== 'number') {
      return;
    }
    const evidence = [...gap.evidence];
    let progress = 0;
    let unit = '';
    let notes: Array<string> = [];
    if (spec.kind === 'tag' && !spec.all) {
      progress = tagsAdded(a, spec.tag, !spec.max);
      unit = `${spec.tag} tag`;
      evidence.push(catalogEvidence(a.name, 'tags'));
    } else if (spec.kind === 'global' && spec.parameter !== 'oceans') {
      progress = globalSteps(state, a, spec.parameter);
      unit = spec.parameter === 'temperature' ? 'temperature step' : 'oxygen step';
      evidence.push(catalogEvidence(a.name, 'effects.onPlay.global'));
      notes = partialNote(a);
    } else if (spec.kind === 'production') {
      progress = productionChange(a, spec.resource);
      unit = `${spec.resource} production`;
      evidence.push(catalogEvidence(a.name, 'effects.onPlay.production'));
      notes = partialNote(a);
    } else {
      return;
    }
    if (progress === 0) {
      return;
    }
    if (gap.comparator === '>=' && progress > 0 && gap.gap > 0) {
      const closes = Math.min(progress, gap.gap);
      const completes = progress >= gap.gap;
      edges.push({
        from: a.name, to: b.name, kind: 'UNLOCKS', amount: closes, completes, requirementIndex: index,
        why: `${a.name} adds ${progress} ${unit}${progress > 1 ? 's' : ''}; ${b.name} needs ${gap.gap} more${completes ? '' : ` (${gap.gap - closes} still missing)`}`,
        support: supportFor(gap, evidence, notes),
      });
      return;
    }
    if (gap.comparator === '<=' && progress > 0 && gap.gap === 0) {
      const scale = spec.kind === 'global' && spec.parameter === 'temperature' ? 2 : 1;
      const room = Math.floor((gap.target - gap.observed) / scale);
      if (progress > room) {
        edges.push({
          from: a.name, to: b.name, kind: 'CONFLICTS_WITH', amount: progress - room, playFirst: b.name, requirementIndex: index,
          why: `${a.name} adds ${progress} ${unit}${progress > 1 ? 's' : ''}, but ${b.name} allows only ${room} more: play ${b.name} first`,
          support: supportFor(gap, evidence, notes),
        });
      }
      return;
    }
    if (spec.kind === 'production' && progress < 0 && gap.gap === 0 && gap.observed + progress < gap.target) {
      edges.push({
        from: a.name, to: b.name, kind: 'CONFLICTS_WITH', amount: -progress, playFirst: b.name, requirementIndex: index,
        why: `${a.name} lowers ${unit} by ${-progress}, below what ${b.name} requires: play ${b.name} first`,
        support: supportFor(gap, evidence, notes),
      });
    }
  });
}

function discountEdge(state: CoachStateV1, a: Card, b: Card, edges: Array<SynergyEdge>) {
  if (b.zone === 'played' || b.catalog === undefined || !PROJECT_TYPES.has(b.catalog.type)) {
    return;
  }
  const discount = discountOn(a.name, b.name);
  if (discount === undefined || discount.amount === 0) {
    return;
  }
  if (a.zone === 'played') {
    if (b.instance.calculatedCost === 0) {
      // The cost is at its floor: how much of this discount still counts depends on the other discounts.
      edges.push({
        from: a.name, to: b.name, kind: 'DISCOUNTS', alreadyApplied: true,
        why: `${a.name} lowers the cost of ${b.name}, which is already down to 0 M€`,
        support: {level: 'verified', evidence: discount.evidence},
      });
      return;
    }
    edges.push({
      from: a.name, to: b.name, kind: 'DISCOUNTS', amount: discount.amount, alreadyApplied: true,
      why: `${a.name} already lowers the cost of ${b.name} by ${discount.amount} M€ (included in its current cost)`,
      support: {level: 'verified', evidence: discount.evidence},
    });
    return;
  }
  const prediction = costAfterDiscount(state, b.instance, b.path, a.name);
  if (prediction.cost === 'unknown') {
    return;
  }
  edges.push({
    from: a.name, to: b.name, kind: 'DISCOUNTS', amount: (b.instance.calculatedCost ?? 0) - prediction.cost,
    why: `with ${a.name} in play, ${b.name} costs ${prediction.cost} M€ instead of ${b.instance.calculatedCost}`,
    support: prediction.support,
  });
}

/* Resources A gives (stock or production, on play or by its action). */
function resourcesGiven(a: Card): Set<Resource> {
  const given = new Set<Resource>();
  for (const atom of a.mechanics?.atoms ?? []) {
    if ((atom.kind === 'stock' || atom.kind === 'production') && atom.amount > 0) {
      given.add(atom.resource);
    }
  }
  return given;
}

function producesForEdges(a: Card, b: Card, edges: Array<SynergyEdge>) {
  const given = resourcesGiven(a);
  if (given.size === 0 || b.catalog === undefined) {
    return;
  }
  const evidence = [catalogEvidence(a.name, 'effects'), catalogEvidence(b.name, 'tags')];
  const support = (used: Array<Evidence>): Support => {
    const notes = partialNote(a);
    return notes.length > 0 ? {level: 'conditional', assumptions: notes, evidence: used} : {level: 'verified', evidence: used};
  };
  if (b.zone !== 'played' && PROJECT_TYPES.has(b.catalog.type)) {
    if (given.has('steel') && b.catalog.tags.includes(Tag.BUILDING)) {
      edges.push({from: a.name, to: b.name, kind: 'PRODUCES_FOR', why: `${a.name} gives steel, which can pay for ${b.name} (building tag)`, support: support(evidence)});
    }
    if (given.has('titanium') && b.catalog.tags.includes(Tag.SPACE)) {
      edges.push({from: a.name, to: b.name, kind: 'PRODUCES_FOR', why: `${a.name} gives titanium, which can pay for ${b.name} (space tag)`, support: support(evidence)});
    }
  }
  if (!actionModeled(b)) {
    return;
  }
  for (const atom of b.mechanics?.atoms ?? []) {
    if (atom.kind === 'spend' && atom.resource !== 'megacredits' && given.has(atom.resource)) {
      edges.push({
        from: a.name, to: b.name, kind: 'PRODUCES_FOR',
        why: `${a.name} gives ${atom.resource}, which the action of ${b.name} spends (${atom.amount})`,
        support: support([catalogEvidence(a.name, 'effects'), catalogEvidence(b.name, 'effects.action.spend')]),
      });
      return;
    }
  }
}

function scoringEdge(state: CoachStateV1, a: Card, b: Card, edges: Array<SynergyEdge>) {
  if (a.zone === 'played') {
    return;
  }
  for (const atom of b.mechanics?.atoms ?? []) {
    if (atom.kind !== 'victoryPointsPerTag') {
      continue;
    }
    const added = tagsAdded(a, atom.tag, false);
    if (added === 0) {
      continue;
    }
    let current = state.me.tags[atom.tag] ?? 0;
    if (b.zone !== 'played' && b.catalog !== undefined) {
      current += count(b.catalog.tags, atom.tag);
    }
    if (atom.all) {
      current += state.opponents.reduce((n, o) => n + (o.tags[atom.tag] ?? 0), 0);
    }
    const vp = (tags: number) => Math.floor(tags * atom.points / atom.per);
    const delta = vp(current + added) - vp(current);
    if (delta <= 0) {
      continue;
    }
    edges.push({
      from: a.name, to: b.name, kind: 'SCORING', amount: delta,
      why: `${a.name} adds ${added} ${atom.tag} tag${added > 1 ? 's' : ''}; ${b.name} scores ${atom.points} VP per ${atom.per}: +${delta} VP`,
      support: {
        level: 'conditional',
        assumptions: [`${b.name} is in play at the end of the game`, 'counted with the tags known now'],
        evidence: [{kind: 'state', fieldPath: `me.tags.${atom.tag}`, stateFingerprint: state.fingerprint}, catalogEvidence(a.name, 'tags'), catalogEvidence(b.name, 'victoryPoints')],
      },
    });
  }
}

/* Two blue card actions that spend the same resource (other than M€) compete for it. */
function competitionEdge(a: Card, b: Card, edges: Array<SynergyEdge>) {
  if (a.name >= b.name || !actionModeled(a) || !actionModeled(b)) {
    return;
  }
  const spends = (card: Card) => new Set((card.mechanics?.atoms ?? []).filter((atom) => atom.kind === 'spend' && atom.source === 'action' && atom.resource !== 'megacredits').map((atom) => (atom as {resource: Resource}).resource));
  const shared = [...spends(a)].filter((resource) => spends(b).has(resource));
  if (shared.length > 0) {
    edges.push({
      from: a.name, to: b.name, kind: 'CONFLICTS_WITH',
      why: `the actions of ${a.name} and ${b.name} both spend ${shared.join(', ')}`,
      support: {level: 'verified', evidence: [catalogEvidence(a.name, 'effects.action.spend'), catalogEvidence(b.name, 'effects.action.spend')]},
    });
  }
}

/**
 * Builds the synergy graph of the cards the player has played, holds and is offered.
 *
 * `maxUnplayed` bounds the unplayed cards considered (the graph grows with their square).
 */
export function buildSynergyGraph(state: CoachStateV1, options: {maxUnplayed?: number} = {}): SynergyGraph {
  const cards = collectCards(state, options.maxUnplayed);
  const nodes: Array<SynergyNode> = cards.map((card) => ({name: card.name, zone: card.zone, mechanics: card.mechanics?.support ?? 'not-in-catalog'}));
  const gaps = new Map<CardName, ReadonlyArray<RequirementGap>>();
  for (const card of cards) {
    if (card.zone !== 'played' && card.mechanics !== undefined) {
      gaps.set(card.name, analyzeRequirements(state, card.mechanics));
    }
  }
  const edges: Array<SynergyEdge> = [];
  for (const a of cards) {
    for (const b of cards) {
      if (a.name === b.name) {
        continue;
      }
      if (a.zone !== 'played' && b.zone !== 'played') {
        requirementEdges(state, a, b, gaps.get(b.name) ?? [], edges);
      }
      discountEdge(state, a, b, edges);
      producesForEdges(a, b, edges);
      scoringEdge(state, a, b, edges);
      competitionEdge(a, b, edges);
    }
  }
  return {
    nodes,
    edges,
    notProduced: [
      {kind: 'FEEDS_RESOURCE', reason: 'adding resources to another card is a target choice; no engine-verified adapter yet'},
      {kind: 'AMPLIFIES', reason: 'effects triggered by other cards are card code (e.g. Media Group); no engine-verified adapter yet'},
    ],
    limitations: [
      'ocean requirements: oceans come from tile placement, which is not modeled',
      'requirements counting all players\' tags are not linked',
      'temperature/oxygen bonuses of the global tracks (extra heat production, oxygen raising temperature) are not counted',
      'M€ given by a card is not linked to particular cards (it pays for everything)',
    ],
  };
}
