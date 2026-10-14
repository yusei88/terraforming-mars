import {IPlayer} from '@/server/IPlayer';
import {IGame} from '@/server/IGame';
import {Server} from '@/server/models/ServerModel';
import {PlayerViewModel, PublicPlayerModel} from '@/common/models/PlayerModel';
import {GameModel} from '@/common/models/GameModel';
import {CardType} from '@/common/cards/CardType';
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {Phase} from '@/common/Phase';
import {TileType} from '@/common/TileType';
import {SpaceBonus} from '@/common/boards/SpaceBonus';
import {MIN_OXYGEN_LEVEL, MIN_TEMPERATURE, MIN_VENUS_SCALE} from '@/common/constants';
import {
  COACH_STATE_SCHEMA,
  CoachAward,
  CoachCardInstance,
  CoachChoices,
  CoachGameState,
  CoachGlobalParameter,
  CoachMilestone,
  CoachPublicPlayer,
  CoachSelfPlayer,
  CoachSpace,
  CoachStateV1,
  CoachStateVersion,
  CoachWarning,
  Observed,
} from '../common/CoachState';
import {VictoryPointsBreakdown} from '@/common/game/VictoryPointsBreakdown';
import {catalogCard, catalogVersion} from './cardCatalog';
import {toCardInstances} from './cardInstances';
import {toChoice} from './choices';
import {advisoryFingerprintOf, fingerprintOf} from './fingerprint';

// Expansions whose cards the schema handles like base cards (tags, costs, resources, choices).
const SUPPORTED_EXPANSIONS: ReadonlySet<string> = new Set(['corpera', 'prelude']);

// Expansion parts outside the schema: they are reported, never filled with guesses.
const UNSUPPORTED_PARTS: Readonly<Record<string, string>> = {
  promo: 'promo cards are listed like base cards, but not validated in Phase 1',
  venus: 'Venus scale is given; floaters and Venus-specific rules are not validated in Phase 1',
  colonies: 'colony tiles, trade fleets and colony bonuses are not normalized',
  prelude2: 'Prelude 2 cards are listed like base cards, but not validated in Phase 1',
  turmoil: 'parties, delegates, global events and the ruling policy are not normalized',
  community: 'community cards are listed like base cards, but not validated in Phase 1',
  ares: 'hazards and adjacency bonuses are not normalized',
  moon: 'the Moon board and its rates are not normalized',
  pathfinders: 'planetary tracks are not normalized',
  ceo: 'CEO cards are listed, their once-per-game actions are not validated',
  starwars: 'Star Wars cards are not validated in Phase 1',
  underworld: 'underground resources, excavation and corruption are not normalized',
  deltaProject: 'Delta Project tracks are not normalized',
};

function parameter(value: number, min: number, max: number, stepSize: number): CoachGlobalParameter {
  return {value, min, max, stepsRemaining: Math.max(0, Math.ceil((max - value) / stepSize))};
}

function spacesOf(game: IGame, model: GameModel): Array<CoachSpace> {
  const models = new Map(model.spaces.map((space) => [space.id, space]));
  return game.board.spaces.map((space) => {
    const spaceModel = models.get(space.id);
    const result: CoachSpace = {
      id: space.id,
      x: space.x,
      y: space.y,
      spaceType: space.spaceType,
      bonus: space.bonus.map((bonus) => SpaceBonus[bonus] ?? String(bonus)),
      adjacent: game.board.getAdjacentSpaces(space).map((adjacent) => adjacent.id),
    };
    if (spaceModel?.color !== undefined) {
      result.ownerColor = spaceModel.color;
    }
    if (space.tile !== undefined) {
      result.tile = {type: TileType[space.tile.tileType] ?? String(space.tile.tileType)};
      if (spaceModel?.color !== undefined) {
        result.tile.ownerColor = spaceModel.color;
      }
    }
    if (spaceModel?.highlight !== undefined) {
      result.highlight = spaceModel.highlight;
    }
    return result;
  });
}

function milestonesOf(model: GameModel): Array<CoachMilestone> {
  return model.milestones.map((milestone) => {
    const result: CoachMilestone = {name: milestone.name, scores: milestone.scores};
    if (milestone.color !== undefined) {
      result.claimedBy = milestone.color;
    }
    if (milestone.threshold !== undefined) {
      result.threshold = milestone.threshold;
    }
    return result;
  });
}

function awardsOf(model: GameModel): Array<CoachAward> {
  return model.awards.map((award) => {
    const result: CoachAward = {name: award.name, scores: award.scores};
    if (award.color !== undefined) {
      result.fundedBy = award.color;
    }
    return result;
  });
}

function gameStateOf(game: IGame, view: PlayerViewModel, warnings: Array<CoachWarning>): CoachGameState {
  const model = view.game;
  const options = model.gameOptions;
  const expansions: Record<string, boolean> = {...options.expansions};
  const unsupported: Array<{part: string, reason: string}> = [];
  for (const [expansion, enabled] of Object.entries(expansions)) {
    if (enabled && !SUPPORTED_EXPANSIONS.has(expansion)) {
      const reason = UNSUPPORTED_PARTS[expansion] ?? 'not covered by coach-state/1';
      unsupported.push({part: expansion, reason});
      warnings.push({code: 'expansion-not-supported', message: `${expansion}: ${reason}`, path: 'game.unsupported'});
    }
  }
  const solo = game.isSoloMode();
  const state: CoachGameState = {
    name: model.name,
    mode: solo ? 'solo' : 'multiplayer',
    playerCount: game.players.length,
    board: options.boardName,
    expansions,
    baseGameOnly: unsupported.length === 0 && expansions.prelude !== true,
    options: {
      draftVariant: options.draftVariant,
      initialDraftVariant: options.initialDraftVariant,
      preludeDraftVariant: options.preludeDraftVariant,
      showOtherPlayersVP: options.showOtherPlayersVP,
      undoOption: options.undoOption,
      soloTR: options.soloTR,
      fastModeOption: options.fastModeOption,
      randomMA: options.randomMA,
    },
    generation: model.generation,
    phase: model.phase,
    lastSoloGeneration: model.lastSoloGeneration,
    activePlayer: game.activePlayer.color,
    firstPlayer: game.first?.color,
    passedPlayers: model.passedPlayers,
    temperature: parameter(model.temperature, MIN_TEMPERATURE, game.max.temperature, 2),
    oxygen: parameter(model.oxygenLevel, MIN_OXYGEN_LEVEL, game.max.oxygen, 1),
    oceans: parameter(model.oceans, 0, game.max.oceans, 1),
    isTerraformed: model.isTerraformed,
    gameOver: model.phase === Phase.END,
    decks: {
      projectDrawPile: model.deckSize,
      projectDiscardPile: model.discardPileSize,
      corporationDrawPile: model.otherDeckSizes.corporations.drawPile,
    },
    spaces: spacesOf(game, model),
    milestones: milestonesOf(model),
    awards: awardsOf(model),
    unsupported,
  };
  if (options.expansions.venus) {
    state.venus = parameter(game.getVenusScaleLevel(), MIN_VENUS_SCALE, game.max.venus, 2);
  }
  if (solo && model.phase === Phase.END) {
    state.soloWin = model.isSoloModeWin;
  }
  if (model.otherDeckSizes.preludes !== undefined) {
    state.decks.preludeDrawPile = model.otherDeckSizes.preludes.drawPile;
  }
  return state;
}

/* Same rule as Server.getPlayer: other players' VP are shown at the end, in solo, or with the option. */
function victoryPointsVisible(game: IGame, isSelf: boolean): boolean {
  return isSelf || game.phase === Phase.END || game.isSoloMode() || game.gameOptions.showOtherPlayersVP === true;
}

function nonZeroTags(tags: Readonly<Record<Tag, number>>): Partial<Record<Tag, number>> {
  const result: Partial<Record<Tag, number>> = {};
  for (const [tag, count] of Object.entries(tags) as Array<[Tag, number]>) {
    if (count > 0) {
      result[tag] = count;
    }
  }
  return result;
}

function corporationsOf(tableau: ReadonlyArray<CoachCardInstance>): Array<CardName> {
  return tableau.filter((card) => catalogCard(card.name)?.type === CardType.CORPORATION).map((card) => card.name);
}

function publicPlayerOf(game: IGame, model: PublicPlayerModel, isSelf: boolean, passed: ReadonlyArray<string>): CoachPublicPlayer {
  const tableau = toCardInstances(model.tableau);
  const victoryPoints: Observed<VictoryPointsBreakdown> = victoryPointsVisible(game, isSelf) ?
    {status: 'known', value: model.victoryPointsBreakdown} :
    {status: 'hidden'};
  const player = game.players.find((p) => p.color === model.color);
  const result: CoachPublicPlayer = {
    color: model.color,
    name: model.name,
    isAi: player?.aiLevel !== undefined,
    isActive: model.isActive,
    hasPassed: passed.includes(model.color),
    terraformRating: model.terraformRating,
    victoryPoints,
    resources: {
      megacredits: model.megacredits, steel: model.steel, titanium: model.titanium,
      plants: model.plants, energy: model.energy, heat: model.heat,
    },
    production: {
      megacredits: model.megacreditProduction, steel: model.steelProduction, titanium: model.titaniumProduction,
      plants: model.plantProduction, energy: model.energyProduction, heat: model.heatProduction,
    },
    steelValue: model.steelValue,
    titaniumValue: model.titaniumValue,
    tags: nonZeroTags(model.tags),
    cardsWithoutTags: model.noTagsCount,
    cardsInHandCount: model.cardsInHandNbr,
    corporations: corporationsOf(tableau),
    tableau,
    actionsUsedThisGeneration: model.actionsThisGeneration,
    actionsTakenThisRound: model.actionsTakenThisRound,
    availableBlueCardActionCount: model.availableBlueCardActionCount,
    citiesCount: model.citiesCount,
    cardCost: model.cardCost,
    protectedResources: model.protectedResources,
    protectedProduction: model.protectedProduction,
    needsToResearch: model.needsToResearch,
    needsToDraft: model.needsToDraft,
  };
  if (model.lastCardPlayed !== undefined) {
    result.lastCardPlayed = model.lastCardPlayed;
  }
  return result;
}

function selfPlayerOf(game: IGame, view: PlayerViewModel, passed: ReadonlyArray<string>): CoachSelfPlayer {
  return {
    ...publicPlayerOf(game, view.thisPlayer, true, passed),
    hand: toCardInstances(view.cardsInHand),
    preludesInHand: toCardInstances(view.preludeCardsInHand),
    ceosInHand: toCardInstances(view.ceoCardsInHand),
    draftedCards: toCardInstances(view.draftedCards),
    dealt: {
      corporations: toCardInstances(view.dealtCorporationCards),
      preludes: toCardInstances(view.dealtPreludeCards),
      projects: toCardInstances(view.dealtProjectCards),
      ceos: toCardInstances(view.dealtCeoCards),
    },
    pickedCorporation: view.pickedCorporationCard.map((card) => card.name),
    autopass: view.autopass,
    canCancelAction: view.canCancelAction === true,
  };
}

function choicesOf(game: IGame, view: PlayerViewModel, warnings: Array<CoachWarning>): CoachChoices {
  if (game.phase === Phase.END) {
    return {status: 'game-over'};
  }
  if (view.waitingFor !== undefined) {
    const choices: CoachChoices = {status: 'awaiting-input', root: toChoice(view.waitingFor, '', warnings)};
    if (view.waitingFor.sourceCard !== undefined) {
      choices.sourceCard = view.waitingFor.sourceCard;
    }
    return choices;
  }
  const waitingFor = game.playersInGenerationOrder
    .filter((player) => {
      const input = player.getWaitingFor();
      return input !== undefined && !input.optional;
    })
    .map((player) => player.color);
  return waitingFor.length === 0 ? {status: 'resolving'} : {status: 'waiting-for-others', waitingFor};
}

function collectCatalogWarnings(state: Pick<CoachStateV1, 'me' | 'opponents'>, warnings: Array<CoachWarning>) {
  const zones: Array<[string, ReadonlyArray<CoachCardInstance>]> = [
    ['me.hand', state.me.hand], ['me.tableau', state.me.tableau], ['me.draftedCards', state.me.draftedCards],
    ['me.preludesInHand', state.me.preludesInHand],
    ...state.opponents.map((opponent, index): [string, ReadonlyArray<CoachCardInstance>] => [`opponents[${index}].tableau`, opponent.tableau]),
  ];
  for (const [path, cards] of zones) {
    for (const card of cards) {
      if (!card.inCatalog) {
        warnings.push({code: 'card-not-in-catalog', message: `${card.name} is not in the coach catalog`, path});
      }
    }
  }
}

/**
 * Projects the game as `player` sees it into a CoachStateV1 snapshot.
 *
 * Reads only: built from `Server.getPlayerModel` (the model the player's page shows) plus public board
 * geometry. `now` is injectable for tests.
 */
export function projectCoachState(player: IPlayer, now: Date = new Date()): CoachStateV1 {
  const game = player.game;
  const view = Server.getPlayerModel(player);
  const warnings: Array<CoachWarning> = [];
  if (player.aiLevel !== undefined) {
    warnings.push({code: 'ai-player', message: 'This player is controlled by the AI; it answers its own inputs'});
  }
  if (game.phase === Phase.END) {
    warnings.push({code: 'game-over', message: 'The game is over; no further choices'});
  }

  const passed = view.game.passedPlayers;
  const me = selfPlayerOf(game, view, passed);
  const opponents = view.players
    .filter((model) => model.color !== player.color)
    .map((model) => publicPlayerOf(game, model, false, passed));
  const gameState = gameStateOf(game, view, warnings);
  const choices = choicesOf(game, view, warnings);
  collectCatalogWarnings({me, opponents}, warnings);

  const version: CoachStateVersion = {
    generation: view.game.generation,
    phase: view.game.phase,
    gameAge: view.game.gameAge,
    gameStep: view.game.step,
    undoCount: view.game.undoCount,
  };
  const fingerprint = fingerprintOf({game: gameState, me, opponents, choices});
  const advisoryFingerprint = advisoryFingerprintOf({game: gameState, me, opponents, choices, warnings});
  return {
    schemaVersion: COACH_STATE_SCHEMA,
    fingerprint,
    advisoryFingerprint,
    stateKey: `${fingerprint.slice(0, 16)}:u${version.undoCount}:s${version.gameStep}:a${version.gameAge}`,
    version,
    catalogVersion: catalogVersion(),
    capturedAt: now.toISOString(),
    warnings,
    game: gameState,
    me,
    opponents,
    choices,
  };
}
