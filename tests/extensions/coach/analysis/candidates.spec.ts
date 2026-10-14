import {expect} from 'chai';
import {buildCandidates, DEFAULT_LIMITS} from '../../../../src/extensions/coach/server/analysis/candidates';
import {affordability} from '../../../../src/extensions/coach/server/analysis/payments';
import {discountOn} from '../../../../src/extensions/coach/server/analysis/discounts';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {CandidateSet} from '../../../../src/extensions/coach/common/CoachAnalysis';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {Game} from '../../../../src/server/Game';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardType} from '../../../../src/common/cards/CardType';
import {Phase} from '../../../../src/common/Phase';
import {newCard, newCorporationCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {maxOutOceans, runAllActions, setOxygenLevel, setTemperature} from '../../../TestingUtils';
import {Payment} from '../../../../src/common/inputs/Payment';

const PROJECT_TYPES: ReadonlySet<string> = new Set([CardType.AUTOMATED, CardType.ACTIVE, CardType.EVENT]);

function projectCardNames(): Array<CardName> {
  return getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') && PROJECT_TYPES.has(c.type)).map((c) => c.name);
}

type Setup = (game: IGame, player: TestPlayer) => void;
const SETUPS: ReadonlyArray<{label: string, setup: Setup}> = [
  {label: 'start', setup: () => {}},
  {label: 'mid', setup: (game, player) => {
    setTemperature(game, -14);
    setOxygenLevel(game, 5);
    maxOutOceans(player, 4);
    for (const name of [CardName.PHYSICS_COMPLEX, CardName.RESEARCH, CardName.LUNAR_BEAM, CardName.EARTH_CATAPULT]) {
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

/* A game in the action phase, the player asked for an action, holding `hand`. */
function actionGame(setup: Setup, hand: ReadonlyArray<CardName>, stock = {megacredits: 30, steel: 3, titanium: 2, plants: 0, energy: 2, heat: 4}) {
  const [game, player] = testGame(1, {skipInitialCardSelection: true});
  setup(game, player);
  game.phase = Phase.ACTION;
  const played = new Set(player.tableau.asArray().map((c) => c.name));
  player.cardsInHand.push(...hand.filter((name) => !played.has(name)).map((name) => newCard(name) as IProjectCard));
  player.stock.override(stock);
  player.takeAction();
  return {game, player};
}

/* Deterministic slices of the card list, so every card is in some hand. */
function hands(size: number): Array<Array<CardName>> {
  const names = projectCardNames();
  const result: Array<Array<CardName>> = [];
  for (let i = 0; i < names.length; i += size) {
    result.push(names.slice(i, i + size));
  }
  return result;
}

function withoutTiming(set: CandidateSet) {
  return {...set, search: {...set.search, elapsedMs: 0}};
}

describe('coach analysis candidates', () => {
  // Gate C: "legal now" only when the game offers the card, and never contradicted by an unmet blocker.
  it('marks cards legal now exactly when the engine can play them', () => {
    const failures: Array<string> = [];
    let legalSeen = 0;
    let conditionalSeen = 0;
    for (const {label, setup} of SETUPS) {
      for (const hand of hands(25)) {
        const {player} = actionGame(setup, hand);
        const set = buildCandidates(projectCoachState(player), {...DEFAULT_LIMITS, maxCandidates: 1000, maxMillis: 10_000});
        for (const plan of set.candidates) {
          plan.cards.forEach((card, index) => {
            const engineCard = player.cardsInHand.find((c) => c.name === card.name);
            if (card.availability === 'legal-now') {
              legalSeen++;
              if (index !== 0 || engineCard === undefined || !player.canPlay(engineCard)) {
                failures.push(`${label}: ${plan.id}: ${card.name} legal-now but the engine cannot play it`);
              }
              const contradictions = plan.blockers.filter((b) => b.card === card.name && b.status === 'unmet');
              if (contradictions.length > 0) {
                failures.push(`${label}: ${card.name} legal-now with unmet ${contradictions.map((b) => b.kind).join(', ')}`);
              }
            } else if (index === 0 && card.zone === 'hand') {
              conditionalSeen++;
              if (engineCard !== undefined && player.canPlay(engineCard)) {
                failures.push(`${label}: ${plan.id}: ${card.name} playable by the engine but not marked legal-now`);
              }
            }
          });
        }
      }
    }
    expect(failures, failures.slice(0, 20).join('\n')).is.empty;
    expect(legalSeen).greaterThan(20);
    expect(conditionalSeen).greaterThan(20);
  }).timeout(120_000);

  // P2-08: what the player can pay, against the engine's own check, for every card in several purses.
  it('judges affordability like the engine (steel, titanium, Helion heat)', () => {
    const purses = [
      {megacredits: 10, steel: 3, titanium: 2, plants: 0, energy: 0, heat: 0},
      {megacredits: 0, steel: 10, titanium: 0, plants: 0, energy: 0, heat: 0},
      {megacredits: 4, steel: 0, titanium: 6, plants: 0, energy: 0, heat: 0},
      {megacredits: 25, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0},
      {megacredits: 5, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 12},
    ];
    const failures: Array<string> = [];
    let compared = 0;
    for (const helion of [false, true]) {
      for (const purse of purses) {
        const [, player] = testGame(1, {skipInitialCardSelection: true});
        if (helion) {
          player.playCorporationCard(newCorporationCard(CardName.HELION)!);
        }
        player.cardsInHand.push(...projectCardNames().map((name) => newCard(name) as IProjectCard));
        player.stock.override(purse);
        const state = projectCoachState(player);
        state.me.hand.forEach((card, i) => {
          const gap = affordability(state, card.name, card.calculatedCost ?? 'unknown', `me.hand[${i}].calculatedCost`);
          if (gap.status !== 'met' && gap.status !== 'unmet') {
            return;
          }
          const engineCard = player.cardsInHand.find((c) => c.name === card.name)!;
          const engine = player.canAfford(player.affordOptionsForCard(engineCard));
          compared++;
          if ((gap.status === 'met') !== engine) {
            failures.push(`${card.name} helion=${helion} ${JSON.stringify(purse)}: analysis ${gap.status}, engine ${engine}`);
          }
        });
      }
    }
    expect(failures, failures.slice(0, 20).join('\n')).is.empty;
    expect(compared).greaterThan(1500);
  }).timeout(60_000);

  // In-plan discounts: play the plan through the engine and compare each card's cost.
  it('predicts the cost of each card of a plan after the earlier ones', () => {
    let checked = 0;
    let known = 0;
    const failures: Array<string> = [];
    for (const {label, setup} of SETUPS) {
      for (const hand of hands(25)) {
        const {player} = actionGame(setup, hand, {megacredits: 500, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0});
        const set = buildCandidates(projectCoachState(player), {...DEFAULT_LIMITS, maxCandidates: 1000, maxMillis: 10_000});
        // A few plans per hand keep the test fast; every hand and scenario is still covered.
        for (const plan of set.candidates.filter((p) => p.cards.length > 1 && p.links.some((l) => l.kind === 'DISCOUNTS' && !l.alreadyApplied)).slice(0, 3)) {
          const {game: g, player: p} = actionGame(setup, hand, {megacredits: 500, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 0});
          plan.cards.forEach((card, index) => {
            if (card.cost === 'unknown') {
              // Allowed only when an earlier card's discount is card code (e.g. Indentured Workers).
              const earlier = plan.cards.slice(0, index).map((c) => c.name);
              if (!earlier.some((name) => discountOn(name, card.name) === undefined)) {
                failures.push(`${label}: ${plan.id}: ${card.name} cost unknown without a reason`);
              }
            }
          });
          for (const card of plan.cards) {
            const engineCard = p.cardsInHand.find((c) => c.name === card.name)!;
            const engineCost = p.getCardCost(engineCard);
            if (card.cost === 'unknown') {
              break;
            }
            if (card.cost !== engineCost) {
              failures.push(`${label}: ${plan.id}: ${card.name} predicted ${card.cost}, engine ${engineCost}`);
            }
            known++;
            p.cardsInHand = p.cardsInHand.filter((c) => c !== engineCard);
            try {
              p.playCard(engineCard, Payment.of({megacredits: engineCost}));
              runAllActions(g);
            } catch {
              break;
            }
          }
          checked++;
        }
      }
    }
    expect(failures, failures.slice(0, 20).join('\n')).is.empty;
    expect(checked).greaterThan(5);
    expect(known).greaterThan(10);
  }).timeout(120_000);

  // Found by the forecast golden: a production decrease needs that production when the card is played.
  it('blocks a production decrease the player cannot afford at that point of the plan', () => {
    const {player} = actionGame(() => {}, [CardName.STRIP_MINE, CardName.STEELWORKS, CardName.POWER_PLANT, CardName.GEOTHERMAL_POWER]);
    const set = buildCandidates(projectCoachState(player), {...DEFAULT_LIMITS, maxCandidates: 100});
    const stripMine = (id: string) => set.candidates.find((p) => p.id === id)?.blockers.filter((b) => b.card === CardName.STRIP_MINE && b.kind === 'production');
    const plans = set.candidates.filter((p) => p.cards.some((c) => c.name === CardName.STRIP_MINE));
    expect(plans.length).greaterThan(0);
    for (const plan of plans) {
      const blockers = stripMine(plan.id) ?? [];
      // Strip Mine lowers energy production by 2; the player starts with 0.
      const before = plan.cards.slice(0, plan.cards.findIndex((c) => c.name === CardName.STRIP_MINE)).map((c) => c.name);
      const energyBefore = (before.includes(CardName.POWER_PLANT) ? 1 : 0) + (before.includes(CardName.GEOTHERMAL_POWER) ? 2 : 0);
      expect(blockers.length, plan.id).eq(energyBefore >= 2 ? 0 : 1);
      if (blockers.length > 0) {
        expect(blockers[0]).deep.include({observed: energyBefore, target: 2, gap: 2 - energyBefore, status: 'unmet'});
      }
    }
  });

  // P2-14
  it('keeps offered cards as conditional with their purchase cost', () => {
    const player = TestPlayer.BLUE.newPlayer();
    Game.newInstance('game-c214', [player], player, 'spectator-c214');
    const state = projectCoachState(player);
    const set = buildCandidates(state);
    for (const plan of set.candidates) {
      for (const card of plan.cards) {
        expect(card.zone).eq('offered');
        expect(card.availability).not.eq('legal-now');
        expect(card.purchaseCost).eq(state.me.cardCost);
      }
      expect(plan.payments.purchase).eq(state.me.cardCost * plan.cards.length);
    }
    expect(set.discarded.some((d) => d.reason.includes('corporation'))).is.true;
  });

  // P2-15
  it('never plans with another player\'s hidden cards', () => {
    const [, alice, bob] = testGame(2, {skipInitialCardSelection: true});
    bob.cardsInHand.push(newCard(CardName.EARTH_OFFICE) as IProjectCard);
    alice.cardsInHand.push(newCard(CardName.CARTEL) as IProjectCard, newCard(CardName.LUNAR_BEAM) as IProjectCard);
    expect(JSON.stringify(buildCandidates(projectCoachState(alice)))).does.not.contain(CardName.EARTH_OFFICE);
  });

  // P2-22
  it('stops at its limits with many cards and says so', () => {
    const {player} = actionGame(SETUPS[1].setup, projectCardNames());
    const state = projectCoachState(player);
    const set = buildCandidates(state);
    // At most the limit (cards that can never be played are dropped from it).
    expect(set.search.poolSize).lessThanOrEqual(DEFAULT_LIMITS.maxPool);
    expect(set.search.poolSize).greaterThan(DEFAULT_LIMITS.maxPool - 5);
    expect(set.search.truncated).is.true;
    expect(set.warnings.join(' ')).contains(`only ${DEFAULT_LIMITS.maxPool} of the`);
    expect(set.candidates.length).lessThanOrEqual(DEFAULT_LIMITS.maxCandidates);
    expect(set.search.elapsedMs).lessThan(1000);

    const tiny = buildCandidates(state, {...DEFAULT_LIMITS, maxChains: 10});
    expect(tiny.search.chainsExamined).lessThanOrEqual(10);
    expect(tiny.warnings.join(' ')).contains('stopped at its limit');
  });

  it('offers plans of several goals side by side', () => {
    const {player} = actionGame(SETUPS[1].setup, projectCardNames().slice(0, 40));
    const set = buildCandidates(projectCoachState(player));
    expect(new Set(set.candidates.map((p) => p.goal)).size).greaterThanOrEqual(2);
    for (const plan of set.candidates) {
      expect(plan.question.text.length).greaterThan(10);
      expect(plan.question.key).matches(/^plan\./);
    }
  });

  it('gives the same plans for the same state', () => {
    const {player} = actionGame(SETUPS[1].setup, projectCardNames().slice(0, 40));
    const state = projectCoachState(player);
    expect(withoutTiming(buildCandidates(state))).deep.eq(withoutTiming(buildCandidates(state)));
  });

  it('drops cards whose maximum requirement is already exceeded', () => {
    const {player} = actionGame((game) => setTemperature(game, 0), [CardName.ARCTIC_ALGAE, CardName.ASTEROID]);
    const set = buildCandidates(projectCoachState(player));
    expect(set.discarded).deep.include({cardName: CardName.ARCTIC_ALGAE, reason: 'a maximum requirement is already exceeded; it can never be played'});
    expect(JSON.stringify(set.candidates)).does.not.contain(CardName.ARCTIC_ALGAE);
  });
});
