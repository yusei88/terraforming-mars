import {expect} from 'chai';
import {costAfterDiscount, discountOn} from '../../../../src/extensions/coach/server/analysis/discounts';
import {allMechanics, mechanicsOf} from '../../../../src/extensions/coach/server/analysis/mechanicsCatalog';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {catalogCard, getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardType} from '../../../../src/common/cards/CardType';
import {newCard, newCorporationCard} from '../../../../src/server/createCard';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {isIActionCard} from '../../../../src/server/cards/ICard';
import {runAllActions} from '../../../TestingUtils';
import {EffectAtom} from '../../../../src/extensions/coach/common/CoachMechanics';
import {Resource} from '../../../../src/common/Resource';
import {Units} from '../../../../src/common/Units';

// Golden tests: predictions of the analysis against the real game engine, on test games only.
// Whatever the analysis calls exact must match the engine exactly (P2 DoD 3).

const RESOURCES: ReadonlyArray<Resource> = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

function projectCards(): Array<CardName> {
  return getCatalog().cards
    .filter((c) => (c.module === 'base' || c.module === 'corpera') && (c.type === CardType.AUTOMATED || c.type === CardType.ACTIVE || c.type === CardType.EVENT))
    .map((c) => c.name);
}

/* Puts a discount card into play through the engine (corporations as corporations). */
function playThroughEngine(player: TestPlayer, name: CardName) {
  const corporation = newCorporationCard(name);
  if (corporation !== undefined) {
    player.playCorporationCard(corporation);
  } else {
    player.playCard(newCard(name) as IProjectCard);
  }
  runAllActions(player.game);
}

describe('coach analysis golden', () => {
  // P2-03 (Earth Office), P2-02 (Space Station), P2-01 (Earth Catapult), P2-04 (several discounts, floor 0)
  const discountCards = getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') && c.cardDiscount !== undefined).map((c) => c.name);

  it('covers the named discount cards', () => {
    for (const name of [CardName.EARTH_OFFICE, CardName.SPACE_STATION, CardName.EARTH_CATAPULT]) {
      expect(discountCards).includes(name);
      expect(discountOn(name, CardName.ALGAE), name).is.not.undefined;
    }
  });

  for (const discountCard of discountCards) {
    it(`predicts every card cost after ${discountCard} exactly`, () => {
      const [, player] = testGame(1, {skipInitialCardSelection: true});
      // Earth Catapult already in play: a second discount stacks on it and costs reach the floor of 0.
      if (discountCard !== CardName.EARTH_CATAPULT) {
        playThroughEngine(player, CardName.EARTH_CATAPULT);
      }
      const names = projectCards().filter((name) => name !== discountCard);
      player.cardsInHand.push(...names.map((name) => newCard(name) as IProjectCard));
      const before = projectCoachState(player);
      const predictions = before.me.hand.map((card, i) => costAfterDiscount(before, card, `me.hand[${i}]`, discountCard));

      playThroughEngine(player, discountCard);
      const after = projectCoachState(player);
      let checked = 0;
      before.me.hand.forEach((card, i) => {
        const prediction = predictions[i];
        if (prediction.cost === 'unknown') {
          return;
        }
        const engineCost = player.getCardCost(player.cardsInHand.find((c) => c.name === card.name)!);
        expect(prediction.cost, `${discountCard} on ${card.name}`).eq(engineCost);
        expect(after.me.hand.find((c) => c.name === card.name)?.calculatedCost, card.name).eq(engineCost);
        expect(prediction.support.level).eq('verified');
        checked++;
      });
      // Every discount card of base and Corporate Era is declarative: nothing is left unknown.
      expect(checked).eq(names.length);
    }).timeout(30_000);
  }

  it('never predicts a cost below 0 with stacked discounts (P2-04)', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    playThroughEngine(player, CardName.EARTH_CATAPULT);
    const cheapest = getCatalog().cards
      .filter((c) => c.module === 'base' && c.type === CardType.AUTOMATED && (c.cost ?? 0) > 0)
      .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))[0];
    expect(cheapest.cost).lessThanOrEqual(4);
    player.cardsInHand.push(newCard(cheapest.name) as IProjectCard);
    const state = projectCoachState(player);
    const prediction = costAfterDiscount(state, state.me.hand[0], 'me.hand[0]', CardName.ANTI_GRAVITY_TECHNOLOGY);
    expect(prediction.cost).eq(0);
    playThroughEngine(player, CardName.ANTI_GRAVITY_TECHNOLOGY);
    expect(player.getCardCost(player.cardsInHand[0])).eq(0);
  });

  it('Earth Office lowers only cards with Earth tags, by 3 per tag', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    const cartel = newCard(CardName.CARTEL) as IProjectCard;
    const algae = newCard(CardName.ALGAE) as IProjectCard;
    player.cardsInHand.push(cartel, algae);
    const state = projectCoachState(player);
    expect(costAfterDiscount(state, state.me.hand[0], 'me.hand[0]', CardName.EARTH_OFFICE).cost).eq(cartel.cost - 3);
    expect(costAfterDiscount(state, state.me.hand[1], 'me.hand[1]', CardName.EARTH_OFFICE).cost).eq(algae.cost);
    expect(catalogCard(CardName.CARTEL)?.tags).includes('earth');
  });

  // Every card the analysis calls fully supported: play it through the engine and compare all effects.
  it('matches the engine for every effect of every supported card', () => {
    const supported = allMechanics().filter((m) => m.support === 'supported' && projectCards().includes(m.name));
    expect(supported.length).greaterThan(40);
    const mismatches: Array<string> = [];
    for (const mechanics of supported) {
      const [game, player] = testGame(1, {skipInitialCardSelection: true});
      // Enough production to pay any production decrease of the card.
      player.production.override({megacredits: 5, steel: 5, titanium: 5, plants: 5, energy: 5, heat: 5});
      const card = newCard(mechanics.name) as IProjectCard;
      const stock = Units.of(player.stock.asUnits());
      const production = Units.of(player.production.asUnits());
      const tr = player.terraformRating;
      const hand = player.cardsInHand.length;
      const temperature = game.getTemperature();
      const oxygen = game.getOxygenLevel();
      const steelValue = player.getSteelValue();
      const titaniumValue = player.getTitaniumValue();

      player.playCard(card);
      runAllActions(game);

      const onPlay = mechanics.atoms.filter((a) => a.source === 'onPlay');
      const expected = {
        stock: sumUnits(onPlay, 'stock'),
        production: sumUnits(onPlay, 'production'),
        tr: onPlay.reduce((n, a) => n + (a.kind === 'tr' ? a.amount : a.kind === 'global' ? a.steps : 0), 0),
        cards: onPlay.reduce((n, a) => n + (a.kind === 'drawCard' ? a.count : 0), 0),
        resources: onPlay.reduce((n, a) => n + (a.kind === 'addResourcesHere' ? a.count : 0), 0),
        temperature: onPlay.reduce((n, a) => n + (a.kind === 'global' && a.parameter === 'temperature' ? a.steps * 2 : 0), 0),
        oxygen: onPlay.reduce((n, a) => n + (a.kind === 'global' && a.parameter === 'oxygen' ? a.steps : 0), 0),
        steelValue: onPlay.reduce((n, a) => n + (a.kind === 'alloyValue' && a.resource === 'steel' ? a.amount : 0), 0),
        titaniumValue: onPlay.reduce((n, a) => n + (a.kind === 'alloyValue' && a.resource === 'titanium' ? a.amount : 0), 0),
      };
      const actual = {
        stock: diff(player.stock.asUnits(), stock),
        production: diff(player.production.asUnits(), production),
        tr: player.terraformRating - tr,
        cards: player.cardsInHand.length - hand,
        resources: card.resourceCount,
        temperature: game.getTemperature() - temperature,
        oxygen: game.getOxygenLevel() - oxygen,
        steelValue: player.getSteelValue() - steelValue,
        titaniumValue: player.getTitaniumValue() - titaniumValue,
      };
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${mechanics.name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches, mismatches.join('\n')).is.empty;
  }).timeout(30_000);

  // Every fully modeled action (also of partial cards): pay, gain and resources here exactly as the engine does.
  it('matches the engine for every fully modeled action', () => {
    const supported = allMechanics().filter((m) => m.atoms.some((a) => a.source === 'action') && !m.unmodeled.some((u) => u.source === 'action'));
    expect(supported.length).greaterThan(10);
    const mismatches: Array<string> = [];
    for (const mechanics of supported) {
      const [game, player] = testGame(1, {skipInitialCardSelection: true});
      player.stock.override({megacredits: 50, steel: 20, titanium: 20, plants: 20, energy: 20, heat: 20});
      // Some actions spend production (e.g. Equatorial Magnetizer).
      player.production.override({megacredits: 5, steel: 5, titanium: 5, plants: 5, energy: 5, heat: 5});
      const card = newCard(mechanics.name);
      player.playedCards.push(card);
      if (!isIActionCard(card) || !card.canAct(player)) {
        mismatches.push(`${mechanics.name}: the engine says the action cannot be taken`);
        continue;
      }
      const stock = Units.of(player.stock.asUnits());
      const production = Units.of(player.production.asUnits());
      const tr = player.terraformRating;
      const hand = player.cardsInHand.length;
      const resources = card.resourceCount;
      const oxygen = game.getOxygenLevel();
      card.action(player);
      runAllActions(game);
      const action = mechanics.atoms.filter((a) => a.source === 'action');
      const gained = sumUnits(action, 'stock');
      const spent = sumUnits(action, 'spend');
      const expected = {
        stock: Object.fromEntries(RESOURCES.map((r) => [r, gained[r] - spent[r]])),
        production: sumUnits(action, 'production'),
        tr: action.reduce((n, a) => n + (a.kind === 'tr' ? a.amount : a.kind === 'global' ? a.steps : 0), 0),
        cards: action.reduce((n, a) => n + (a.kind === 'drawCard' ? a.count : 0), 0),
        resources: action.reduce((n, a) => n + (a.kind === 'addResourcesHere' ? a.count : 0), 0),
        oxygen: action.reduce((n, a) => n + (a.kind === 'global' && a.parameter === 'oxygen' ? a.steps : 0), 0),
      };
      const actual = {
        stock: diff(player.stock.asUnits(), stock),
        production: diff(player.production.asUnits(), production),
        tr: player.terraformRating - tr,
        cards: player.cardsInHand.length - hand,
        resources: card.resourceCount - resources,
        oxygen: game.getOxygenLevel() - oxygen,
      };
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${mechanics.name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches, mismatches.join('\n')).is.empty;
  }).timeout(30_000);

  // Every supported corporation: starting M€, production and research card cost as the engine applies them.
  it('matches the engine for every supported corporation', () => {
    const supported = allMechanics().filter((m) => m.support === 'supported' && newCorporationCard(m.name) !== undefined);
    expect(supported.length).greaterThan(3);
    const mismatches: Array<string> = [];
    for (const mechanics of supported) {
      const [game, player] = testGame(1, {skipInitialCardSelection: true});
      const megaCredits = player.megaCredits;
      const production = Units.of(player.production.asUnits());
      const cardCost = player.cardCost;
      player.playCorporationCard(newCorporationCard(mechanics.name)!);
      runAllActions(game);
      const starting = mechanics.atoms.reduce((n, a) => n + (a.kind === 'startingMegaCredits' ? a.amount : 0), 0);
      const research = mechanics.atoms.find((a) => a.kind === 'researchCardCost');
      const expected = {
        megaCredits: starting + sumUnits(mechanics.atoms.filter((a) => a.source === 'onPlay'), 'stock').megacredits,
        production: sumUnits(mechanics.atoms.filter((a) => a.source === 'onPlay'), 'production'),
        cardCost: research?.kind === 'researchCardCost' ? research.amount : cardCost,
      };
      const actual = {
        megaCredits: player.megaCredits - megaCredits,
        production: diff(player.production.asUnits(), production),
        cardCost: player.cardCost,
      };
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches.push(`${mechanics.name}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
      }
    }
    expect(mismatches, mismatches.join('\n')).is.empty;
  }).timeout(30_000);

  // Every card whose victory points are modeled: VP from the atoms (tags and resources as the snapshot shows
  // them) against the engine's score, after playing the card in a game with tags and resources on it.
  it('matches the engine for every modeled victory point rule', () => {
    const modeled = allMechanics().filter((m) => projectCards().includes(m.name) &&
      m.atoms.some((a) => a.kind === 'victoryPoints' || a.kind === 'victoryPointsPerResource' || a.kind === 'victoryPointsPerTag') &&
      !m.unmodeled.some((u) => u.source === 'victoryPoints' || u.key === 'getVictoryPoints'));
    expect(modeled.length).greaterThan(40);
    const mismatches: Array<string> = [];
    for (const mechanics of modeled) {
      for (const extra of [0, 3, 7]) {
        const [, player, opponent] = testGame(2, {skipInitialCardSelection: true});
        // Some tags of every kind on both players (the VP rule may count all players).
        for (const name of [CardName.IO_MINING_INDUSTRIES, CardName.PHYSICS_COMPLEX, CardName.EARTH_OFFICE, CardName.KELP_FARMING].slice(0, extra === 0 ? 0 : 4)) {
          if (name !== mechanics.name) {
            player.playedCards.push(newCard(name));
          }
        }
        opponent.playedCards.push(newCard(CardName.GANYMEDE_COLONY));
        // In play without resolving its effects (scoring only needs it on the tableau).
        const card = newCard(mechanics.name) as IProjectCard;
        player.playedCards.push(card);
        card.resourceCount = extra;
        const state = projectCoachState(player);
        let predicted = 0;
        for (const atom of mechanics.atoms) {
          if (atom.kind === 'victoryPoints') {
            predicted += atom.amount;
          } else if (atom.kind === 'victoryPointsPerResource') {
            predicted += Math.floor(extra * atom.points / atom.per);
          } else if (atom.kind === 'victoryPointsPerTag') {
            const tags = (state.me.tags[atom.tag] ?? 0) + (atom.all ? state.opponents.reduce((n, o) => n + (o.tags[atom.tag] ?? 0), 0) : 0);
            predicted += Math.floor(tags * atom.points / atom.per);
          }
        }
        const engine = card.getVictoryPoints(player);
        if (predicted !== engine) {
          mismatches.push(`${mechanics.name} (resources ${extra}): predicted ${predicted}, engine ${engine}`);
        }
      }
    }
    expect(mismatches, mismatches.join('\n')).is.empty;
  }).timeout(30_000);

  // P2-09 / Algae golden: the requirement and the effect, from the snapshot to the engine.
  it('Algae: plant production +2 and 1 plant, exactly as the engine plays it', () => {
    const algae = mechanicsOf(CardName.ALGAE)!;
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    player.playCard(newCard(CardName.ALGAE) as IProjectCard);
    runAllActions(game);
    expect(player.production.plants).eq(sumUnits(algae.atoms, 'production').plants);
    expect(player.plants).eq(sumUnits(algae.atoms, 'stock').plants);
  });
});

function sumUnits(atoms: ReadonlyArray<EffectAtom>, kind: 'stock' | 'production' | 'spend'): Record<Resource, number> {
  const result = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<Resource, number>;
  for (const atom of atoms) {
    if (atom.kind === kind) {
      result[atom.resource] += atom.amount;
    }
  }
  return result;
}

function diff(now: Units, then: Units): Record<Resource, number> {
  return Object.fromEntries(RESOURCES.map((r) => [r, now[r] - then[r]])) as Record<Resource, number>;
}
