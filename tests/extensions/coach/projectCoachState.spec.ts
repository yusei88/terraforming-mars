import {expect} from 'chai';
import {Game} from '../../../src/server/Game';
import {IGame} from '../../../src/server/IGame';
import {Server} from '../../../src/server/models/ServerModel';
import {projectCoachState} from '../../../src/extensions/coach/server/projectCoachState';
import {CoachChoice, CoachStateV1} from '../../../src/extensions/coach/common/CoachState';
import {testGame} from '../../TestGame';
import {TestPlayer} from '../../TestPlayer';
import {Phase} from '../../../src/common/Phase';
import {CardName} from '../../../src/common/cards/CardName';
import {EarthCatapult} from '../../../src/server/cards/base/EarthCatapult';
import {SpaceStation} from '../../../src/server/cards/base/SpaceStation';
import {Tardigrades} from '../../../src/server/cards/base/Tardigrades';
import {Algae} from '../../../src/server/cards/base/Algae';
import {AsteroidMining} from '../../../src/server/cards/base/AsteroidMining';
import {Sabotage} from '../../../src/server/cards/base/Sabotage';
import {PowerPlant} from '../../../src/server/cards/base/PowerPlant';
import {Ants} from '../../../src/server/cards/base/Ants';
import {addCity, addGreenery, addOcean, finishGeneration} from '../../TestingUtils';
import {answer, expectNoSecretIds} from './coachTestUtils';
import {TileType} from '../../../src/common/TileType';
import * as titles from '../../../src/common/inputs/SelectInitialCards';

function find(choice: CoachChoice | undefined, predicate: (c: CoachChoice) => boolean): CoachChoice | undefined {
  if (choice === undefined) {
    return undefined;
  }
  if (predicate(choice)) {
    return choice;
  }
  for (const option of choice.options ?? []) {
    const found = find(option, predicate);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function root(state: CoachStateV1): CoachChoice {
  expect(state.choices.status).eq('awaiting-input');
  if (state.choices.status !== 'awaiting-input') {
    throw new Error('no input');
  }
  return state.choices.root;
}

function soloInActionPhase(): [IGame, TestPlayer] {
  const [game, player] = testGame(1, {skipInitialCardSelection: true});
  game.phase = Phase.ACTION;
  return [game, player];
}

describe('coach projectCoachState', () => {
  // S01
  it('describes a new solo game', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-s01', [player], player, 'spectator-s01');
    const state = projectCoachState(player);

    expect(state.schemaVersion).eq('coach-state/1');
    expect(state.game.mode).eq('solo');
    expect(state.game.baseGameOnly).is.true;
    expect(state.game.generation).eq(1);
    expect(state.game.phase).eq(Phase.RESEARCH);
    expect(state.game.temperature).deep.eq({value: -30, min: -30, max: 8, stepsRemaining: 19});
    expect(state.game.oxygen).deep.eq({value: 0, min: 0, max: 14, stepsRemaining: 14});
    expect(state.game.oceans).deep.eq({value: 0, min: 0, max: 9, stepsRemaining: 9});
    expect(state.game.venus).is.undefined;
    expect(state.game.spaces.length).eq(game.board.spaces.length);
    expect(state.game.decks.projectDrawPile).eq(game.projectDeck.drawPile.length);
    expect(state.opponents).is.empty;
    expect(state.me.terraformRating).eq(14);

    const initial = root(state);
    expect(initial.inputType).eq('initialCards');
    expect(initial.options?.map((o) => o.inputType)).deep.eq(['card', 'card']);
    expect(initial.options?.[0].path).eq('0');
    expect(initial.options?.[0].cards).has.length(2);
    expect(initial.options?.[1].cards).has.length(10);
    expect(state.me.dealt.corporations.map((c) => c.name)).deep.eq(initial.options?.[0].cards?.map((c) => c.name));
    expectNoSecretIds(state, game);
  });

  // S02
  it('follows the corporation and initial card choice', () => {
    const player = TestPlayer.BLUE.newPlayer();
    const game = Game.newInstance('game-s02', [player], player, 'spectator-s02');
    const before = projectCoachState(player);
    const initial = root(before);
    const corporation = initial.options![0].cards![0].name;
    const bought = initial.options![1].cards!.slice(0, 2).map((c) => c.name);
    player.process({type: 'initialCards', responses: [{type: 'card', cards: [corporation]}, {type: 'card', cards: bought}]});

    const after = projectCoachState(player);
    expect(after.me.corporations).deep.eq([corporation]);
    expect(after.me.hand.map((c) => c.name)).deep.eq(bought);
    expect(after.me.resources.megacredits).eq(player.megaCredits);
    expect(after.fingerprint).not.eq(before.fingerprint);
    expect(game.phase).eq(Phase.ACTION);
    expect(root(after).inputType).eq('or');
  });

  // S22
  it('shows the prelude choice of the opening', () => {
    const player = TestPlayer.BLUE.newPlayer();
    Game.newInstance('game-s22', [player], player, 'spectator-s22', {preludeExtension: true});
    const state = projectCoachState(player);
    const initial = root(state);
    expect(initial.options?.map((o) => o.title)).deep.eq([titles.SELECT_CORPORATION_TITLE, titles.SELECT_PRELUDE_TITLE, titles.SELECT_PROJECTS_TITLE]);
    expect(initial.options?.[1]).deep.include({min: 2, max: 2});
    expect(state.me.dealt.preludes.map((c) => c.name)).deep.eq(initial.options?.[1].cards?.map((c) => c.name));
    expect(state.game.baseGameOnly).is.false;
    expect(state.warnings.filter((w) => w.code === 'expansion-not-supported')).is.empty;

    const corporation = initial.options![0].cards![0].name;
    const preludes = initial.options![1].cards!.slice(0, 2).map((c) => c.name);
    player.process({type: 'initialCards', responses: [{type: 'card', cards: [corporation]}, {type: 'card', cards: preludes}, {type: 'card', cards: []}]});
    const after = projectCoachState(player);
    expect(after.game.phase).eq(Phase.PRELUDES);
    expect(after.me.preludesInHand.map((c) => c.name)).deep.eq(preludes);
  });

  it('reports expansions it does not cover', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true, venusNextExtension: true, coloniesExtension: true});
    const state = projectCoachState(player);
    expect(state.game.venus?.max).eq(30);
    expect(state.game.unsupported.map((u) => u.part)).deep.eq(['venus', 'colonies']);
    expect(state.warnings.filter((w) => w.code === 'expansion-not-supported')).has.length(2);
  });

  // S05, S06
  it('offers only the cards that can be played now', () => {
    const [, player] = soloInActionPhase();
    player.megaCredits = 20;
    player.cardsInHand.push(new PowerPlant(), new Algae(), new AsteroidMining());
    player.takeAction();
    const state = projectCoachState(player);

    expect(state.me.hand.map((c) => c.name)).deep.eq([CardName.POWER_PLANT, CardName.ALGAE, CardName.ASTEROID_MINING]);
    const play = find(root(state), (c) => c.inputType === 'projectCard');
    // Algae: needs 5 oceans. Asteroid Mining: costs 30. Neither is a legal choice now.
    expect(play?.cards?.map((c) => c.name)).deep.eq([CardName.POWER_PLANT]);
    expect(play?.paymentOptions).is.not.undefined;
  });

  it('applies a played card', () => {
    const [, player] = soloInActionPhase();
    player.megaCredits = 20;
    player.cardsInHand.push(new PowerPlant());
    player.takeAction();
    const state = projectCoachState(player);
    const response = answer(root(state), state);
    player.process(response);

    const after = projectCoachState(player);
    expect(after.me.tableau.map((c) => c.name)).includes(CardName.POWER_PLANT);
    expect(after.me.production.energy).eq(1);
    expect(after.me.resources.megacredits).eq(20 - 4);
    expect(after.me.tags.power).eq(1);
  });

  // S07
  it('shows discounted costs from Earth Catapult and Space Station', () => {
    const [, player] = soloInActionPhase();
    player.cardsInHand.push(new AsteroidMining(), new Algae());
    let state = projectCoachState(player);
    expect(state.me.hand.map((c) => c.calculatedCost)).deep.eq([30, 10]);

    player.playedCards.push(new EarthCatapult());
    state = projectCoachState(player);
    expect(state.me.hand.map((c) => c.calculatedCost)).deep.eq([28, 8]);

    player.playedCards.push(new SpaceStation());
    state = projectCoachState(player);
    // Space Station: -2 more for the space tag of Asteroid Mining only.
    expect(state.me.hand.map((c) => c.calculatedCost)).deep.eq([26, 8]);
    const catapult = state.me.tableau.find((c) => c.name === CardName.EARTH_CATAPULT);
    expect(catapult?.discount).deep.eq([{amount: 2}]);
  });

  // S08
  it('reports production and its effect on the next generation', () => {
    const [game, player] = soloInActionPhase();
    player.production.override({megacredits: 3, steel: 1, titanium: 0, plants: 2, energy: 1, heat: 0});
    const before = projectCoachState(player);
    expect(before.me.production).deep.eq({megacredits: 3, steel: 1, titanium: 0, plants: 2, energy: 1, heat: 0});
    const mc = player.megaCredits;

    finishGeneration(game);
    const after = projectCoachState(player);
    expect(after.game.generation).eq(before.game.generation + 1);
    // Production phase pays production plus TR in M€; energy left from before turns into heat first.
    expect(after.me.resources.megacredits).eq(mc + 3 + player.terraformRating);
    expect(after.me.resources.plants).eq(2);
    expect(after.me.resources.energy).eq(1);
    expect(after.me.resources.heat).eq(0);
  });

  // S09, S10
  it('shows tiles, owners and placement bonuses', () => {
    const [, player] = soloInActionPhase();
    const greenery = addGreenery(player);
    const city = addCity(player);
    const ocean = addOcean(player);
    const state = projectCoachState(player);
    const space = (id: string) => state.game.spaces.find((s) => s.id === id)!;

    expect(space(greenery.id).tile).deep.eq({type: TileType[TileType.GREENERY], ownerColor: player.color});
    expect(space(city.id).tile).deep.eq({type: TileType[TileType.CITY], ownerColor: player.color});
    // Oceans have no owner.
    expect(space(ocean.id).tile).deep.eq({type: TileType[TileType.OCEAN]});
    expect(state.game.oxygen.value).eq(1);
    expect(state.game.oceans.value).eq(1);
    expect(state.me.citiesCount).eq(1);
    const withBonus = state.game.spaces.find((s) => s.bonus.length > 0);
    expect(withBonus?.bonus.every((b) => typeof b === 'string')).is.true;
    expect(space(greenery.id).adjacent.length).greaterThan(0);
  });

  // S11
  it('shows resources on cards and used actions', () => {
    const [, player] = soloInActionPhase();
    const tardigrades = new Tardigrades();
    player.playedCards.push(tardigrades);
    tardigrades.resourceCount = 3;
    player.takeAction();
    let state = projectCoachState(player);
    expect(state.me.tableau.find((c) => c.name === CardName.TARDIGRADES)?.resources).eq(3);
    expect(state.me.availableBlueCardActionCount).eq(1);
    const action = find(root(state), (c) => c.selectBlueCardAction === true);
    expect(action?.cards?.map((c) => c.name)).deep.eq([CardName.TARDIGRADES]);

    player.process({type: 'or', index: Number(action!.path), response: {type: 'card', cards: [CardName.TARDIGRADES]}});
    state = projectCoachState(player);
    expect(state.me.tableau.find((c) => c.name === CardName.TARDIGRADES)?.resources).eq(4);
    expect(state.me.actionsUsedThisGeneration).deep.eq([CardName.TARDIGRADES]);
  });

  // S14
  it('marks the end of the game', () => {
    const [game, player] = soloInActionPhase();
    game.phase = Phase.END;
    const state = projectCoachState(player);
    expect(state.game.gameOver).is.true;
    expect(state.choices).deep.eq({status: 'game-over'});
    expect(state.game.soloWin).is.a('boolean');
    expect(state.me.victoryPoints.status).eq('known');
    expect(state.warnings.map((w) => w.code)).includes('game-over');
  });

  // S15
  it('does not change the game when read', () => {
    const [game, player] = soloInActionPhase();
    player.cardsInHand.push(new PowerPlant(), new Algae());
    player.megaCredits = 30;
    player.takeAction();
    const waitingFor = player.getWaitingFor();
    const serialized = JSON.stringify(game.serialize());
    const gameAge = game.gameAge;

    const first = projectCoachState(player, new Date(1000));
    const second = projectCoachState(player, new Date(2000));

    expect(JSON.stringify(game.serialize())).eq(serialized);
    expect(game.gameAge).eq(gameAge);
    expect(player.getWaitingFor()).eq(waitingFor);
    expect(second.fingerprint).eq(first.fingerprint);
    expect(second.stateKey).eq(first.stateKey);
    expect(second.capturedAt).not.eq(first.capturedAt);
  });

  it('matches the model the player page shows', () => {
    const [, player] = soloInActionPhase();
    player.cardsInHand.push(new PowerPlant());
    player.megaCredits = 17;
    player.steel = 2;
    player.playedCards.push(new Tardigrades());
    player.takeAction();
    const view = Server.getPlayerModel(player);
    const state = projectCoachState(player);

    expect(state.me.resources.megacredits).eq(view.thisPlayer.megacredits);
    expect(state.me.resources.steel).eq(view.thisPlayer.steel);
    expect(state.me.terraformRating).eq(view.thisPlayer.terraformRating);
    expect(state.me.hand.map((c) => [c.name, c.calculatedCost])).deep.eq(view.cardsInHand.map((c) => [c.name, c.calculatedCost]));
    expect(state.me.tableau.map((c) => c.name)).deep.eq(view.thisPlayer.tableau.map((c) => c.name));
    expect(state.version.gameAge).eq(view.game.gameAge);
    expect(state.version.gameStep).eq(view.game.step);
    expect(state.version.undoCount).eq(view.game.undoCount);
    expect(root(state).options?.length).eq((view.waitingFor as {options: Array<unknown>}).options.length);
  });

  describe('multiplayer', () => {
    // S25, S26, S27
    it('shows only public information about other players', () => {
      const [game, alice, bob] = testGame(2, {skipInitialCardSelection: true});
      alice.cardsInHand.push(new PowerPlant());
      bob.cardsInHand.push(new Sabotage(), new Ants());
      bob.megaCredits = 33;
      bob.playedCards.push(new Tardigrades());

      const aliceView = projectCoachState(alice);
      const json = JSON.stringify(aliceView);
      expect(json).does.not.contain(CardName.SABOTAGE);
      expect(json).does.not.contain(CardName.ANTS);
      expectNoSecretIds(aliceView, game);

      const bobPublic = aliceView.opponents[0];
      expect(bobPublic.color).eq(bob.color);
      expect(bobPublic.cardsInHandCount).eq(2);
      expect(bobPublic.resources.megacredits).eq(33);
      expect(bobPublic.tableau.map((c) => c.name)).includes(CardName.TARDIGRADES);
      expect(bobPublic.victoryPoints).deep.eq({status: 'hidden'});
      expect(Object.keys(bobPublic)).does.not.include('hand');

      // Bob's own view and Alice's view agree on what is public.
      const bobView = projectCoachState(bob);
      const bobSelf = bobView.me;
      for (const key of ['color', 'name', 'terraformRating', 'resources', 'production', 'tags', 'cardsInHandCount', 'tableau'] as const) {
        expect(bobPublic[key], key).deep.eq(bobSelf[key]);
      }
      expect(bobView.game.spaces).deep.eq(aliceView.game.spaces);
      expect(bobView.me.victoryPoints.status).eq('known');
    });

    it('shows other players\' VP when the option is on', () => {
      const [, alice] = testGame(2, {skipInitialCardSelection: true, showOtherPlayersVP: true});
      expect(projectCoachState(alice).opponents[0].victoryPoints.status).eq('known');
    });

    it('keeps other players\' dealt cards secret', () => {
      const [alice, bob] = [TestPlayer.BLUE.newPlayer(), TestPlayer.RED.newPlayer()];
      Game.newInstance('game-dealt', [alice, bob], alice, 'spectator-dealt');
      const aliceView = projectCoachState(alice);
      const json = JSON.stringify(aliceView);
      const aliceCards = new Set([...alice.dealtCorporationCards, ...alice.dealtProjectCards].map((c) => c.name));
      const bobCards = [...bob.dealtCorporationCards, ...bob.dealtProjectCards].map((c) => c.name);
      expect(bobCards.length).greaterThan(0);
      for (const name of bobCards.filter((n) => !aliceCards.has(n))) {
        expect(json).does.not.contain(`"${name}"`);
      }
    });

    // S31
    it('updates the board after another player acts', () => {
      const [, alice, bob] = testGame(2, {skipInitialCardSelection: true});
      const before = projectCoachState(alice);
      const city = addCity(bob);
      const after = projectCoachState(alice);
      expect(after.fingerprint).not.eq(before.fingerprint);
      expect(after.game.spaces.find((s) => s.id === city.id)?.tile?.ownerColor).eq(bob.color);
      expect(after.opponents[0].citiesCount).eq(1);
    });
  });
});
