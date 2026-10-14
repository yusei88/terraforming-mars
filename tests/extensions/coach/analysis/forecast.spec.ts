import {expect} from 'chai';
import {forecastPlan, playCards, produce, productionsLeft, SimState, startOf} from '../../../../src/extensions/coach/server/analysis/forecast';
import {buildCandidates, DEFAULT_LIMITS} from '../../../../src/extensions/coach/server/analysis/candidates';
import {mechanicsOf} from '../../../../src/extensions/coach/server/analysis/mechanicsCatalog';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {CandidatePlan} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardType} from '../../../../src/common/cards/CardType';
import {Phase} from '../../../../src/common/Phase';
import {Resource} from '../../../../src/common/Resource';
import {newCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {maxOutOceans, runAllActions, setOxygenLevel, setTemperature} from '../../../TestingUtils';
import {Payment} from '../../../../src/common/inputs/Payment';

const RESOURCES: ReadonlyArray<Resource> = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];
const PROJECT_TYPES: ReadonlySet<string> = new Set([CardType.AUTOMATED, CardType.ACTIVE, CardType.EVENT]);

function sim(overrides: Partial<SimState> = {}): SimState {
  const zero = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<Resource, number>;
  return {stock: {...zero, megacredits: 50}, production: {...zero}, terraformRating: 20, temperature: -30, oxygen: 0, maxTemperature: 8, maxOxygen: 14, ...overrides};
}

type Setup = (game: IGame, player: TestPlayer) => void;
const SETUPS: ReadonlyArray<{label: string, setup: Setup}> = [
  {label: 'start', setup: () => {}},
  {label: 'mid', setup: (game, player) => {
    setTemperature(game, -22);
    setOxygenLevel(game, 6);
    maxOutOceans(player, 4);
    player.production.override({megacredits: 2, steel: 1, titanium: 1, plants: 2, energy: 2, heat: 1});
  }},
  {label: 'late', setup: (game, player) => {
    setTemperature(game, -2);
    setOxygenLevel(game, 13);
    maxOutOceans(player, 8);
  }},
];

function projectCardNames(): Array<CardName> {
  return getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') && PROJECT_TYPES.has(c.type)).map((c) => c.name);
}

function actionGame(setup: Setup, hand: ReadonlyArray<CardName>) {
  const [game, player] = testGame(1, {skipInitialCardSelection: true});
  setup(game, player);
  game.phase = Phase.ACTION;
  player.cardsInHand.push(...hand.map((name) => newCard(name) as IProjectCard));
  player.stock.override({megacredits: 300, steel: 2, titanium: 1, plants: 3, energy: 4, heat: 5});
  player.takeAction();
  return {game, player};
}

function snapshot(player: TestPlayer) {
  return {
    stock: Object.fromEntries(RESOURCES.map((r) => [r, player.stock.get(r)])) as Record<Resource, number>,
    production: Object.fromEntries(RESOURCES.map((r) => [r, player.production.get(r)])) as Record<Resource, number>,
    tr: player.terraformRating,
  };
}

describe('coach analysis forecast', () => {
  // P2-10
  it('does not call an investment paid back too early (cost 10, M€ production +2)', () => {
    const notes: Array<string> = [];
    const start = sim();
    let withPlan = playCards(start, [{name: CardName.SPONSORS, cost: 10, atoms: [{kind: 'production', source: 'onPlay', resource: 'megacredits', amount: 2}]}], 0, notes);
    let without = start;
    const balances: Array<number> = [withPlan.stock.megacredits - without.stock.megacredits];
    for (let i = 0; i < 3; i++) {
      withPlan = produce(withPlan);
      without = produce(without);
      balances.push(withPlan.stock.megacredits - without.stock.megacredits);
    }
    expect(balances).deep.eq([-10, -8, -6, -4]);
  });

  // P2-09
  it('follows plant production over the generations (Algae)', () => {
    const algae = mechanicsOf(CardName.ALGAE)!;
    let state = playCards(sim(), [{name: CardName.ALGAE, cost: 10, atoms: algae.atoms}], 0, []);
    const plants = [state.stock.plants];
    for (let i = 0; i < 3; i++) {
      state = produce(state);
      plants.push(state.stock.plants);
    }
    expect(plants).deep.eq([1, 3, 5, 7]);
  });

  it('applies the global track bonuses like the engine', () => {
    const notes: Array<string> = [];
    const temp = playCards(sim({temperature: -26}), [{name: CardName.ASTEROID, cost: 0, atoms: [{kind: 'global', source: 'onPlay', parameter: 'temperature', steps: 2}]}], 0, notes);
    expect([temp.temperature, temp.terraformRating, temp.production.heat]).deep.eq([-22, 22, 1]);
    const oxygen = playCards(sim({oxygen: 7, temperature: -26}), [{name: CardName.ASTEROID, cost: 0, atoms: [{kind: 'global', source: 'onPlay', parameter: 'oxygen', steps: 2}]}], 0, notes);
    // 2 oxygen steps, and reaching 8 % raises temperature one step (passing -24 °C: heat production).
    expect([oxygen.oxygen, oxygen.temperature, oxygen.terraformRating, oxygen.production.heat]).deep.eq([9, -24, 23, 1]);
    expect(notes).is.empty;
    const capped = playCards(sim({temperature: 6}), [{name: CardName.ASTEROID, cost: 0, atoms: [{kind: 'global', source: 'onPlay', parameter: 'temperature', steps: 2}]}], 0, notes);
    expect([capped.temperature, capped.terraformRating]).deep.eq([8, 21]);
    playCards(sim({temperature: -2}), [{name: CardName.ASTEROID, cost: 0, atoms: [{kind: 'global', source: 'onPlay', parameter: 'temperature', steps: 1}]}], 0, notes);
    expect(notes.join()).contains('places an ocean');
  });

  // P2-23
  it('counts the production phases left in a solo game', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    const last = game.lastSoloGeneration();
    game.generation = last;
    expect(productionsLeft(projectCoachState(player))).eq(1);
    game.generation = last - 1;
    expect(productionsLeft(projectCoachState(player))).eq(2);
    game.phase = Phase.PRODUCTION;
    expect(productionsLeft(projectCoachState(player))).eq(1);
    game.phase = Phase.END;
    expect(productionsLeft(projectCoachState(player))).eq(0);
    const [, alice] = testGame(2, {skipInitialCardSelection: true});
    expect(productionsLeft(projectCoachState(alice))).eq('unknown');
  });

  it('cuts the horizon at the end of a solo game and says so', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    game.generation = game.lastSoloGeneration();
    player.cardsInHand.push(newCard(CardName.SPONSORS) as IProjectCard);
    player.playedCards.push(newCard(CardName.EARTH_OFFICE) as IProjectCard);
    player.megaCredits = 30;
    player.takeAction();
    const plan = buildCandidates(projectCoachState(player), DEFAULT_LIMITS, undefined, 3).candidates[0];
    expect(plan.forecast?.horizonProductionPhases).eq(3);
    expect(plan.forecast?.productionPhases).eq(1);
    expect(plan.forecast?.deltas).has.length(2);
    expect(plan.forecast?.assumptions.join(' ')).contains('only 1 production phase left');
  });

  it('never gives totals for plans with unmodeled effects', () => {
    const {player} = actionGame(SETUPS[0].setup, projectCardNames().slice(0, 40));
    const plans = buildCandidates(projectCoachState(player), {...DEFAULT_LIMITS, maxCandidates: 200}, undefined, 3).candidates;
    const incomplete = plans.filter((p) => p.forecast?.complete === false);
    expect(incomplete.length).greaterThan(0);
    for (const plan of incomplete) {
      expect(plan.forecast?.megacredits, plan.id).eq('unknown');
      expect(plan.forecast?.unmodeledEffects.length, plan.id).greaterThan(0);
    }
  });

  it('rejects a horizon outside 0–3', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    const plan = {cards: [], payments: {play: 0, purchase: 0}} as unknown as CandidatePlan;
    expect(() => forecastPlan(projectCoachState(player), plan, 4)).to.throw('horizon');
  });

  // Gate D: every complete forecast against the engine (play the plan, then run the production phases).
  it('matches the engine for every complete forecast', () => {
    const failures: Array<string> = [];
    let checked = 0;
    const names = projectCardNames();
    for (const {label, setup} of SETUPS) {
      for (let i = 0; i < names.length; i += 25) {
        const hand = names.slice(i, i + 25);
        const {player} = actionGame(setup, hand);
        const state = projectCoachState(player);
        const plans = buildCandidates(state, {...DEFAULT_LIMITS, maxCandidates: 200, maxMillis: 10_000}, undefined, 3).candidates
          .filter((p) => p.forecast?.complete === true);
        for (const plan of plans.slice(0, 15)) {
          const forecast = plan.forecast!;
          const {game: g, player: p} = actionGame(setup, hand);
          const {player: p0} = actionGame(setup, hand);
          const vpBefore = p.tableau.asArray().reduce((n, c) => n + c.getVictoryPoints(p), 0);
          let ok = true;
          for (const card of plan.cards) {
            const engineCard = p.cardsInHand.find((c) => c.name === card.name)!;
            p.cardsInHand = p.cardsInHand.filter((c) => c !== engineCard);
            try {
              p.playCard(engineCard, Payment.of({megacredits: p.getCardCost(engineCard)}));
              runAllActions(g);
            } catch {
              ok = false;
              break;
            }
          }
          // A plan whose play leaves a question pending (e.g. a tile to place) cannot be compared.
          if (!ok || g.deferredActions.length > 0) {
            continue;
          }
          const compare = (index: number) => {
            const a = snapshot(p);
            const b = snapshot(p0);
            const delta = forecast.deltas[index];
            const actual = {
              resources: Object.fromEntries(RESOURCES.map((r) => [r, a.stock[r] - b.stock[r]])),
              production: Object.fromEntries(RESOURCES.map((r) => [r, a.production[r] - b.production[r]])),
              terraformRating: a.tr - b.tr,
            };
            const expected = {resources: delta.resources, production: delta.production, terraformRating: delta.terraformRating};
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
              failures.push(`${label}: ${plan.id} after ${index} productions: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
            }
          };
          compare(0);
          if (forecast.victoryPoints !== 'unknown') {
            const vpAfter = p.tableau.asArray().reduce((n, c) => n + c.getVictoryPoints(p), 0);
            const engineVp = vpAfter - vpBefore + (p.terraformRating - p0.terraformRating);
            if (engineVp !== forecast.victoryPoints.total) {
              failures.push(`${label}: ${plan.id} VP: expected ${forecast.victoryPoints.total} got ${engineVp}`);
            }
          }
          for (let k = 1; k < forecast.deltas.length; k++) {
            p.runProductionPhase();
            p0.runProductionPhase();
            compare(k);
          }
          checked++;
        }
      }
    }
    expect(failures, failures.slice(0, 20).join('\n')).is.empty;
    console.log(`      complete forecasts compared: ${checked}`);
    expect(checked).greaterThan(30);
  }).timeout(120_000);

  it('starts from the snapshot', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    player.megaCredits = 17;
    player.production.override({megacredits: 3, steel: 0, titanium: 0, plants: 1, energy: 0, heat: 0});
    const start = startOf(projectCoachState(player));
    expect([start.stock.megacredits, start.production.megacredits, start.production.plants, start.terraformRating]).deep.eq([17, 3, 1, player.terraformRating]);
  });
});
