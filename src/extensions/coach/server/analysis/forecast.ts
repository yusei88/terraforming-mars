import {CoachStateV1} from '../../common/CoachState';
import {CandidatePlan, PlanForecast, ResourceAmounts} from '../../common/CoachAnalysis';
import {EffectAtom} from '../../common/CoachMechanics';
import {CardName} from '@/common/cards/CardName';
import {CardType} from '@/common/cards/CardType';
import {Phase} from '@/common/Phase';
import {Resource} from '@/common/Resource';
import {Tag} from '@/common/cards/Tag';
import {catalogCard} from '../cardCatalog';
import {mechanicsOf} from './mechanicsCatalog';

// Conservative forecast (Gate D): plays the plan now, then runs 0–3 production phases with the engine's
// rules (Player.runProductionPhase, Game.increaseTemperature/increaseOxygenLevel), once with and once
// without the plan, and reports the difference. Only effect atoms count; anything else makes the forecast
// incomplete and is listed. Pure: works on numbers taken from the snapshot.

const RESOURCES: ReadonlyArray<Resource> = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
const HEAT_BONUSES: ReadonlyArray<number> = [-24, -20];
const OCEAN_BONUS_TEMPERATURE = 0;
const OXYGEN_FOR_TEMPERATURE = 8;
// Phases after which the current generation's production has already happened.
const AFTER_PRODUCTION: ReadonlySet<string> = new Set([Phase.PRODUCTION, Phase.SOLAR, Phase.INTERGENERATION]);

/** Numbers of the game the simulation changes. */
export type SimState = {
  stock: Record<Resource, number>,
  production: Record<Resource, number>,
  terraformRating: number,
  temperature: number,
  oxygen: number,
  maxTemperature: number,
  maxOxygen: number,
};

/** One card played in the simulation: what it costs and its effect atoms. */
export type SimCard = {name: CardName, cost: number, atoms: ReadonlyArray<EffectAtom>};

/** Things the simulation saw but does not model (e.g. the ocean placed at 0 °C). */
export type SimNotes = Array<string>;

function clone(state: SimState): SimState {
  return {...state, stock: {...state.stock}, production: {...state.production}};
}

/* Game.increaseTemperature for the acting player: steps capped at the maximum, TR, heat production at
   -24/-20 °C; the ocean at 0 °C is a tile placement and only noted. */
function raiseTemperature(state: SimState, increments: number, notes: SimNotes) {
  if (state.temperature >= state.maxTemperature) {
    return;
  }
  const steps = Math.min(increments, (state.maxTemperature - state.temperature) / 2);
  for (const bonus of HEAT_BONUSES) {
    if (state.temperature < bonus && state.temperature + steps * 2 >= bonus) {
      state.production.heat += 1;
    }
  }
  state.terraformRating += steps;
  if (state.temperature < OCEAN_BONUS_TEMPERATURE && state.temperature + steps * 2 >= OCEAN_BONUS_TEMPERATURE) {
    notes.push('reaching 0 °C places an ocean (TR, placement bonus and its space are not modeled)');
  }
  state.temperature += steps * 2;
}

/* Game.increaseOxygenLevel: steps capped, TR, and reaching 8 % raises temperature one step. */
function raiseOxygen(state: SimState, increments: number, notes: SimNotes) {
  if (state.oxygen >= state.maxOxygen) {
    return;
  }
  const steps = Math.min(increments, state.maxOxygen - state.oxygen);
  state.terraformRating += steps;
  if (state.oxygen < OXYGEN_FOR_TEMPERATURE && state.oxygen + steps >= OXYGEN_FOR_TEMPERATURE) {
    raiseTemperature(state, 1, notes);
  }
  state.oxygen += steps;
}

/** Lowest production allowed per resource (constants.PRODUCTION_MINIMUMS). */
export const PRODUCTION_MINIMUM: Readonly<Record<Resource, number>> = {megacredits: -5, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0};

/**
 * Resources whose production a card's on-play production change would take below the minimum
 * (Production.canAdjust: the whole change is checked at once; such a card cannot be played).
 */
export function productionShortfalls(production: Readonly<Record<Resource, number>>, atoms: ReadonlyArray<EffectAtom>): Array<{resource: Resource, have: number, change: number}> {
  const change = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<Resource, number>;
  for (const atom of atoms) {
    if (atom.source === 'onPlay' && atom.kind === 'production') {
      change[atom.resource] += atom.amount;
    }
  }
  return RESOURCES.filter((r) => production[r] + change[r] < PRODUCTION_MINIMUM[r]).map((r) => ({resource: r, have: production[r], change: change[r]}));
}

/** Pays and plays the cards in order with their on-play atoms (purchase costs are paid first). */
export function playCards(start: SimState, cards: ReadonlyArray<SimCard>, purchase: number, notes: SimNotes): SimState {
  const state = clone(start);
  state.stock.megacredits -= purchase;
  for (const card of cards) {
    for (const shortfall of productionShortfalls(state.production, card.atoms)) {
      notes.push(`${card.name} cannot be played then: ${shortfall.resource} production ${shortfall.have} cannot change by ${shortfall.change}`);
    }
    state.stock.megacredits -= card.cost;
    for (const atom of card.atoms) {
      if (atom.source !== 'onPlay') {
        continue;
      }
      switch (atom.kind) {
      case 'stock':
        state.stock[atom.resource] += atom.amount;
        break;
      case 'production':
        state.production[atom.resource] += atom.amount;
        break;
      case 'tr':
        state.terraformRating += atom.amount;
        break;
      case 'global':
        if (atom.parameter === 'temperature') {
          raiseTemperature(state, atom.steps, notes);
        } else {
          raiseOxygen(state, atom.steps, notes);
        }
        break;
      default:
        break;
      }
    }
  }
  return state;
}

/** Player.runProductionPhase: energy becomes heat, then production (and TR as M€) is added. */
export function produce(start: SimState): SimState {
  const state = clone(start);
  state.stock.heat += state.stock.energy;
  state.stock.energy = 0;
  state.stock.megacredits += state.production.megacredits + state.terraformRating;
  for (const resource of RESOURCES) {
    if (resource !== 'megacredits') {
      state.stock[resource] += state.production[resource];
    }
  }
  return state;
}

function difference(a: Record<Resource, number>, b: Record<Resource, number>): ResourceAmounts {
  return Object.fromEntries(RESOURCES.map((r) => [r, a[r] - b[r]])) as ResourceAmounts;
}

/** Production phases left in the game for the snapshot, or unknown (multiplayer: ends when terraformed). */
export function productionsLeft(state: CoachStateV1): number | 'unknown' {
  if (state.game.gameOver) {
    return 0;
  }
  if (state.game.mode !== 'solo') {
    return 'unknown';
  }
  const thisGeneration = AFTER_PRODUCTION.has(state.game.phase) ? 0 : 1;
  return Math.max(0, state.game.lastSoloGeneration - state.game.generation + thisGeneration);
}

export function startOf(state: CoachStateV1): SimState {
  return {
    stock: {...state.me.resources},
    production: {...state.me.production},
    terraformRating: state.me.terraformRating,
    temperature: state.game.temperature.value,
    oxygen: state.game.oxygen.value,
    maxTemperature: state.game.temperature.max,
    maxOxygen: state.game.oxygen.max,
  };
}

/* Tags a played card keeps (events keep none). */
function tagsKept(name: CardName): ReadonlyArray<Tag> {
  const card = catalogCard(name);
  return card === undefined || card.type === CardType.EVENT ? [] : card.tags;
}

/* VP the plan cards add now, and the VP that tag-scoring cards already in play gain from their tags. */
function cardVictoryPoints(state: CoachStateV1, names: ReadonlyArray<CardName>): number | 'unknown' {
  const added = new Map<Tag, number>();
  for (const name of names) {
    for (const tag of tagsKept(name)) {
      added.set(tag, (added.get(tag) ?? 0) + 1);
    }
  }
  const tagsNow = (tag: Tag, all: boolean) => (state.me.tags[tag] ?? 0) + (all ? state.opponents.reduce((n, o) => n + (o.tags[tag] ?? 0), 0) : 0);
  let total = 0;
  for (const name of names) {
    const mechanics = mechanicsOf(name);
    if (mechanics === undefined || mechanics.unmodeled.some((u) => u.source === 'victoryPoints' || u.key === 'getVictoryPoints')) {
      return 'unknown';
    }
    for (const atom of mechanics.atoms) {
      if (atom.kind === 'victoryPoints') {
        total += atom.amount;
      } else if (atom.kind === 'victoryPointsPerTag') {
        total += Math.floor((tagsNow(atom.tag, atom.all) + (added.get(atom.tag) ?? 0)) * atom.points / atom.per);
      } else if (atom.kind === 'victoryPointsPerResource') {
        const resources = mechanics.atoms.reduce((n, a) => n + (a.kind === 'addResourcesHere' && a.source === 'onPlay' ? a.count : 0), 0);
        total += Math.floor(resources * atom.points / atom.per);
      }
    }
  }
  // Cards already in play that score per tag gain from the plan's tags.
  for (const played of state.me.tableau) {
    for (const atom of mechanicsOf(played.name)?.atoms ?? []) {
      if (atom.kind === 'victoryPointsPerTag' && (added.get(atom.tag) ?? 0) > 0) {
        const before = tagsNow(atom.tag, atom.all);
        total += Math.floor((before + (added.get(atom.tag) ?? 0)) * atom.points / atom.per) - Math.floor(before * atom.points / atom.per);
      }
    }
  }
  return total;
}

/* Hooks of cards in play that react to plays, tags, tiles or productions (card code, not modeled). */
const REACTION_HOOKS: ReadonlySet<string> = new Set([
  'onCardPlayed', 'onCardPlayedByAnyPlayer', 'onNonCardTagAdded', 'onNonCardTagAddedByAnyPlayer', 'onTilePlaced',
  'onGlobalParameterIncrease', 'onProductionPhase', 'onIncreaseTerraformRatingByAnyPlayer', 'onResourceAdded', 'onProductionGain',
]);

/** Forecast of one plan over `horizon` production phases (0–3). */
export function forecastPlan(state: CoachStateV1, plan: CandidatePlan, horizon: number): PlanForecast {
  if (!Number.isInteger(horizon) || horizon < 0 || horizon > 3) {
    throw new Error('horizon must be 0, 1, 2 or 3');
  }
  const left = productionsLeft(state);
  const phases = left === 'unknown' ? horizon : Math.min(horizon, left);
  const assumptions: Array<string> = ['costs are paid in M€ (steel or titanium could replace part of them)', 'the plan is played before the next production phase'];
  if (left === 'unknown') {
    assumptions.push('the game may end before the horizon (it ends when Mars is terraformed)');
  } else if (phases < horizon) {
    assumptions.push(`only ${left} production phase${left === 1 ? '' : 's'} left in this solo game`);
  }
  const unmodeled: Array<string> = [];
  const cards: Array<SimCard> = [];
  for (const card of plan.cards) {
    const mechanics = mechanicsOf(card.name);
    if (mechanics === undefined) {
      unmodeled.push(`${card.name}: not in the catalog`);
      continue;
    }
    for (const u of mechanics.unmodeled) {
      unmodeled.push(`${card.name}: ${u.reason}`);
    }
    if (mechanics.atoms.some((a) => a.kind === 'drawCard' && a.source === 'onPlay')) {
      unmodeled.push(`${card.name}: the drawn cards are unknown`);
    }
    if (mechanics.atoms.some((a) => a.source === 'action')) {
      assumptions.push(`the action of ${card.name} is not counted (it is optional each generation)`);
    }
    cards.push({name: card.name, cost: typeof card.cost === 'number' ? card.cost : 0, atoms: mechanics.atoms});
  }
  for (const played of state.me.tableau) {
    const hooks = mechanicsOf(played.name)?.unmodeled.filter((u) => REACTION_HOOKS.has(u.key)) ?? [];
    if (hooks.length > 0) {
      unmodeled.push(`${played.name} (in play) may react: ${hooks.map((h) => h.key).join(', ')}`);
    }
  }
  if (state.game.unsupported.length > 0) {
    unmodeled.push(`expansions not covered: ${state.game.unsupported.map((u) => u.part).join(', ')}`);
  }
  const playCost = plan.payments.play;
  if (playCost === 'unknown') {
    unmodeled.push('the cost of a card of the plan is unknown');
  }
  const notes: SimNotes = [];
  let withPlan = playCards(startOf(state), cards, plan.payments.purchase, notes);
  let without = startOf(state);
  const deltas: Array<PlanForecast['deltas'][number]> = [];
  const record = (index: number) => deltas.push({
    productionIndex: index,
    resources: difference(withPlan.stock, without.stock),
    production: difference(withPlan.production, without.production),
    terraformRating: withPlan.terraformRating - without.terraformRating,
  });
  record(0);
  for (let i = 1; i <= phases; i++) {
    withPlan = produce(withPlan);
    without = produce(without);
    record(i);
  }
  unmodeled.push(...new Set(notes));
  const complete = unmodeled.length === 0;
  const last = deltas[deltas.length - 1];
  // Balance: M€ difference to not playing the plan at the end of the horizon (costs included).
  // Returned: what came back within the horizon (immediate M€, production, TR income) = balance + paid.
  const paid = playCost === 'unknown' ? undefined : playCost + plan.payments.purchase;
  const megacredits = !complete || paid === undefined ? 'unknown' as const : {
    returned: last.resources.megacredits + paid,
    balance: last.resources.megacredits,
    recovered: last.resources.megacredits >= 0,
  };
  const cardsVp = cardVictoryPoints(state, plan.cards.map((c) => c.name));
  const trVp = deltas[0].terraformRating;
  const victoryPoints = cardsVp === 'unknown' ? 'unknown' as const : {total: trVp + cardsVp, terraformRating: trVp, cards: cardsVp};
  return {
    horizonProductionPhases: horizon,
    productionPhases: phases,
    productionsLeft: left,
    deltas,
    upfront: {play: playCost, purchase: plan.payments.purchase},
    megacredits,
    victoryPoints,
    complete,
    unmodeledEffects: [...new Set(unmodeled)],
    assumptions: [...new Set(assumptions)],
  };
}
