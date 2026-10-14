import {expect} from 'chai';
import {buildSynergyGraph} from '../../../../src/extensions/coach/server/analysis/synergyGraph';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {SynergyEdge} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {Game} from '../../../../src/server/Game';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardType} from '../../../../src/common/cards/CardType';
import {newCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {CardRequirements} from '../../../../src/server/cards/requirements/CardRequirements';
import {InequalityRequirement} from '../../../../src/server/cards/requirements/InequalityRequirement';
import {maxOutOceans, runAllActions, setOxygenLevel, setTemperature} from '../../../TestingUtils';
import {PaymentOptions} from '../../../../src/common/inputs/Payment';
import {RequirementType} from '../../../../src/common/cards/RequirementType';

const PROJECT_TYPES: ReadonlySet<string> = new Set([CardType.AUTOMATED, CardType.ACTIVE, CardType.EVENT]);

function projectCardNames(): Array<CardName> {
  return getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') && PROJECT_TYPES.has(c.type)).map((c) => c.name);
}

type Scenario = {label: string, setup: (game: IGame, player: TestPlayer) => void};

const TAG_FILLERS: ReadonlyArray<CardName> = [
  CardName.PHYSICS_COMPLEX, CardName.RESEARCH, CardName.LUNAR_BEAM, CardName.TRANS_NEPTUNE_PROBE, CardName.KELP_FARMING,
];

const SCENARIOS: ReadonlyArray<Scenario> = [
  {label: 'start', setup: () => {}},
  {label: 'mid', setup: (game, player) => {
    setTemperature(game, -14);
    setOxygenLevel(game, 5);
    maxOutOceans(player, 4);
    for (const name of TAG_FILLERS) {
      player.playedCards.push(newCard(name) as IProjectCard);
    }
    player.production.override({megacredits: 2, steel: 1, titanium: 1, plants: 2, energy: 2, heat: 1});
  }},
  {label: 'late', setup: (game, player) => {
    setTemperature(game, 4);
    setOxygenLevel(game, 12);
    maxOutOceans(player, 8);
  }},
];

/* A test game in the scenario, with Earth Catapult played and every other project card in hand. */
function build(scenario: Scenario, withCatapult = true): {game: IGame, player: TestPlayer} {
  const [game, player] = testGame(1, {skipInitialCardSelection: true});
  scenario.setup(game, player);
  if (withCatapult) {
    player.playCard(newCard(CardName.EARTH_CATAPULT) as IProjectCard);
    runAllActions(game);
  }
  const played = new Set(player.tableau.asArray().map((c) => c.name));
  player.cardsInHand.push(...projectCardNames().filter((name) => !played.has(name)).map((name) => newCard(name) as IProjectCard));
  player.megaCredits = 200;
  return {game, player};
}

function requirementOf(player: TestPlayer, card: CardName, index: number) {
  const instance = player.cardsInHand.find((c) => c.name === card) ?? (newCard(card) as IProjectCard);
  const requirement = CardRequirements.compile([...instance.requirements]).requirements[index];
  const score = requirement instanceof InequalityRequirement ? requirement.getScore(player, instance) : undefined;
  return {satisfies: requirement.satisfies(player, instance), score, scale: requirement.type === RequirementType.TEMPERATURE ? 2 : 1};
}

function playThroughEngine(player: TestPlayer, name: CardName): boolean {
  const card = player.cardsInHand.find((c) => c.name === name) ?? (newCard(name) as IProjectCard);
  try {
    player.cardsInHand = player.cardsInHand.filter((c) => c.name !== name);
    player.playCard(card);
    runAllActions(player.game);
    return true;
  } catch {
    return false;
  }
}

describe('coach analysis synergyGraph', () => {
  // P2-13
  it('shows discounts of played cards as already included, never twice', () => {
    const {player} = build(SCENARIOS[0]);
    const state = projectCoachState(player);
    const graph = buildSynergyGraph(state);
    const fromCatapult = graph.edges.filter((e) => e.from === CardName.EARTH_CATAPULT && e.kind === 'DISCOUNTS');
    expect(fromCatapult.length).greaterThan(100);
    const cost = (name: CardName) => state.me.hand.find((c) => c.name === name)?.calculatedCost;
    // 2 M€ each, except cards already down to 0, where the amount that still counts is not claimed.
    expect(fromCatapult.every((e) => e.alreadyApplied === true && (e.amount === 2 || (e.amount === undefined && cost(e.to) === 0)))).is.true;
    expect(fromCatapult.some((e) => e.amount === undefined)).is.true;
    // The current cost already contains it: printed cost - 2 (not - 4).
    const algae = state.me.hand.find((c) => c.name === CardName.ALGAE)!;
    expect(algae.calculatedCost).eq(10 - 2);
  });

  it('predicts discounts of cards still in hand (Earth Office on Cartel)', () => {
    const {player} = build(SCENARIOS[0]);
    const graph = buildSynergyGraph(projectCoachState(player));
    const edge = graph.edges.find((e) => e.from === CardName.EARTH_OFFICE && e.to === CardName.CARTEL && e.kind === 'DISCOUNTS');
    expect(edge?.amount).eq(3);
    expect(edge?.alreadyApplied).is.undefined;
    expect(edge?.support.level).eq('verified');
  });

  it('never links cards only because they share a tag', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    // Both have power and building tags; neither gives steel, needs a tag, discounts or scores tags.
    const pair = [CardName.POWER_PLANT, CardName.GEOTHERMAL_POWER];
    player.cardsInHand.push(...pair.map((name) => newCard(name) as IProjectCard));
    const graph = buildSynergyGraph(projectCoachState(player));
    expect(graph.edges.filter((e) => pair.includes(e.from) && pair.includes(e.to))).is.empty;
  });

  it('links steel to building cards (Mine pays for Power Plant)', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    player.cardsInHand.push(newCard(CardName.MINE) as IProjectCard, newCard(CardName.POWER_PLANT) as IProjectCard);
    const edges = buildSynergyGraph(projectCoachState(player)).edges;
    expect(edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).deep.eq([`${CardName.MINE}>${CardName.POWER_PLANT}:PRODUCES_FOR`]);
  });

  it('orders a temperature raise after a maximum temperature card', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    // Arctic Algae allows at most -12 °C; one more step (Asteroid) would exceed it.
    setTemperature(game, -12);
    player.cardsInHand.push(newCard(CardName.ARCTIC_ALGAE) as IProjectCard, newCard(CardName.ASTEROID) as IProjectCard);
    const edge = buildSynergyGraph(projectCoachState(player)).edges.find((e) => e.kind === 'CONFLICTS_WITH' && e.to === CardName.ARCTIC_ALGAE);
    expect(edge).deep.include({from: CardName.ASTEROID, playFirst: CardName.ARCTIC_ALGAE, amount: 1});
  });

  it('counts temperature room in 2 °C steps', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    // -14 °C with a maximum of -12 °C leaves exactly one step.
    setTemperature(game, -14);
    player.cardsInHand.push(...[CardName.ARCTIC_ALGAE, CardName.ASTEROID, CardName.BIG_ASTEROID].map((name) => newCard(name) as IProjectCard));
    const conflicts = buildSynergyGraph(projectCoachState(player)).edges.filter((e) => e.kind === 'CONFLICTS_WITH' && e.to === CardName.ARCTIC_ALGAE);
    // Asteroid (+1 step) still fits; Big Asteroid (+2 steps) exceeds it by one step.
    expect(conflicts.map((e) => [e.from, e.amount])).deep.eq([[CardName.BIG_ASTEROID, 1]]);
  });

  // P2-14
  it('keeps offered cards apart from the hand', () => {
    const player = TestPlayer.BLUE.newPlayer();
    Game.newInstance('game-p214', [player], player, 'spectator-p214');
    const graph = buildSynergyGraph(projectCoachState(player));
    expect(graph.nodes.length).greaterThan(10);
    expect(graph.nodes.every((n) => n.zone === 'offered')).is.true;
    expect(graph.nodes.map((n) => n.name)).includes(player.dealtProjectCards[0].name);
  });

  // P2-15
  it('never uses another player\'s hidden cards', () => {
    const [, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    bob.cardsInHand.push(newCard(CardName.EARTH_OFFICE) as IProjectCard, newCard(CardName.ASTEROID) as IProjectCard);
    alice.cardsInHand.push(newCard(CardName.CARTEL) as IProjectCard);
    const json = JSON.stringify(buildSynergyGraph(projectCoachState(alice)));
    expect(json).does.not.contain(CardName.EARTH_OFFICE);
    expect(json).does.not.contain(`"${CardName.ASTEROID}"`);
  });

  it('lists what it does not produce', () => {
    const graph = buildSynergyGraph(projectCoachState(testGame(1)[1]));
    expect(graph.notProduced.map((n) => n.kind)).deep.eq(['FEEDS_RESOURCE', 'AMPLIFIES']);
    expect(graph.limitations.length).greaterThan(0);
  });

  // Gate B: no false positives. Every edge is checked with the engine on a fresh test game.
  for (const scenario of SCENARIOS) {
    it(`agrees with the engine for every edge (${scenario.label})`, () => {
      const {player} = build(scenario);
      const state = projectCoachState(player);
      const graph = buildSynergyGraph(state);
      const failures: Array<string> = [];
      const unverifiable: Array<string> = [];
      const checked: Record<string, number> = {};
      const count = (kind: string) => checked[kind] = (checked[kind] ?? 0) + 1;

      // Requirement edges and discounts: one game per card A, before/after playing A.
      const byFrom = new Map<CardName, Array<SynergyEdge>>();
      for (const edge of graph.edges) {
        if (edge.kind === 'UNLOCKS' || (edge.kind === 'CONFLICTS_WITH' && edge.requirementIndex !== undefined) || (edge.kind === 'DISCOUNTS' && !edge.alreadyApplied)) {
          byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge]);
        }
      }
      for (const [from, edges] of byFrom) {
        const {player: p} = build(scenario);
        const before = new Map(edges.filter((e) => e.requirementIndex !== undefined).map((e) => [e, requirementOf(p, e.to, e.requirementIndex!)]));
        if (!playThroughEngine(p, from)) {
          unverifiable.push(from);
          continue;
        }
        for (const edge of edges) {
          count(edge.kind);
          if (edge.kind === 'DISCOUNTS') {
            const target = p.cardsInHand.find((c) => c.name === edge.to)!;
            const was = state.me.hand.find((c) => c.name === edge.to)?.calculatedCost ?? 0;
            if (p.getCardCost(target) !== was - (edge.amount ?? 0)) {
              failures.push(`${edge.from}>${edge.to} DISCOUNTS: engine ${p.getCardCost(target)} expected ${was - (edge.amount ?? 0)}`);
            }
            continue;
          }
          const was = before.get(edge)!;
          const now = requirementOf(p, edge.to, edge.requirementIndex!);
          if (edge.kind === 'UNLOCKS') {
            const ok = edge.completes ?
              !was.satisfies && now.satisfies :
              !now.satisfies && (now.score ?? 0) - (was.score ?? 0) >= (edge.amount ?? 0) * was.scale;
            if (!ok) {
              failures.push(`${edge.from}>${edge.to} UNLOCKS: before ${JSON.stringify(was)} after ${JSON.stringify(now)} claim ${edge.amount}${edge.completes ? ' completes' : ''}`);
            }
          } else if (!(was.satisfies && !now.satisfies)) {
            failures.push(`${edge.from}>${edge.to} CONFLICTS_WITH: before ${was.satisfies} after ${now.satisfies}`);
          }
        }
      }

      // Discounts already applied: the engine cost without Earth Catapult is higher by the amount.
      const {player: without} = build(scenario, false);
      for (const edge of graph.edges.filter((e) => e.alreadyApplied && e.amount !== undefined)) {
        count('DISCOUNTS(applied)');
        const target = without.cardsInHand.find((c) => c.name === edge.to)!;
        const now = state.me.hand.find((c) => c.name === edge.to)?.calculatedCost ?? 0;
        if (without.getCardCost(target) - now !== edge.amount) {
          failures.push(`${edge.from}>${edge.to} DISCOUNTS(applied): ${without.getCardCost(target)} - ${now} != ${edge.amount}`);
        }
      }

      // Steel and titanium payments: the engine's payment rule for the card.
      for (const edge of graph.edges.filter((e) => e.kind === 'PRODUCES_FOR' && /gives (steel|titanium), which can pay/.test(e.why))) {
        count('PRODUCES_FOR(payment)');
        const card = newCard(edge.to) as IProjectCard;
        const options = (player as unknown as {paymentOptionsForCard(c: IProjectCard): PaymentOptions}).paymentOptionsForCard(card);
        const resource = edge.why.includes('gives steel') ? 'steel' : 'titanium';
        if (options[resource] !== true) {
          failures.push(`${edge.from}>${edge.to} PRODUCES_FOR: engine does not accept ${resource}`);
        }
      }

      // Scoring: VP of B with and without A, both played through the engine.
      for (const edge of graph.edges.filter((e) => e.kind === 'SCORING')) {
        count('SCORING');
        const vpOf = (playA: boolean) => {
          const {player: p} = build(scenario);
          if (playA && !playThroughEngine(p, edge.from)) {
            return undefined;
          }
          if (!p.tableau.has(edge.to)) {
            playThroughEngine(p, edge.to);
          }
          return p.tableau.get(edge.to)?.getVictoryPoints(p);
        };
        const without = vpOf(false);
        const with_ = vpOf(true);
        if (without === undefined || with_ === undefined) {
          unverifiable.push(`${edge.from}>${edge.to}`);
        } else if (with_ - without !== edge.amount) {
          failures.push(`${edge.from}>${edge.to} SCORING: engine +${with_ - without}, claimed +${edge.amount}`);
        }
      }

      console.log(`      ${scenario.label}: ${graph.nodes.length} cards, ${graph.edges.length} edges, checked ${JSON.stringify(checked)}, unverifiable ${unverifiable.length}`);
      expect(failures, failures.slice(0, 20).join('\n')).is.empty;
      expect(unverifiable.length, unverifiable.join(', ')).lessThanOrEqual(5);
      expect(Object.values(checked).reduce((a, b) => a + b, 0)).greaterThan(50);
    }).timeout(120_000);
  }
});
