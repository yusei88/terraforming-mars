// Read-only view of a game for the strategy coach (schema `coach-state/1`).
//
// Built only from what the requesting player may see (PlayerViewModel plus public board data).
// Every value is either known, hidden by the rules, or not supported yet: a coach must never
// mistake a hidden or missing value for 0. Static card data lives in the catalog (CoachCatalog.ts);
// cards here carry only their name and what depends on the game.
import {CardName} from '@/common/cards/CardName';
import {Color} from '@/common/Color';
import {Phase} from '@/common/Phase';
import {Tag} from '@/common/cards/Tag';
import {SpaceId} from '@/common/Types';
import {CardDiscount, AdditionalProjectCosts} from '@/common/cards/Types';
import {Warning} from '@/common/cards/Warning';
import {Units} from '@/common/Units';
import {Resource} from '@/common/Resource';
import {VictoryPointsBreakdown} from '@/common/game/VictoryPointsBreakdown';
import {PaymentOptions} from '@/common/inputs/Payment';

export const COACH_STATE_SCHEMA = 'coach-state/1';

/** A value as the requesting player can observe it. */
export type Observed<T> =
  {status: 'known', value: T} |
  /** The rules hide the value from this player (e.g. an opponent's VP while that option is off). */
  {status: 'hidden'} |
  /** The value exists but this schema does not extract it yet. */
  {status: 'unsupported', reason: string};

/** Data-quality note attached to a snapshot. */
export type CoachWarning = {
  code: CoachWarningCode,
  message: string,
  /** JSON path inside the snapshot the warning is about. */
  path?: string,
};

export const COACH_WARNING_CODES = [
  'expansion-not-supported',
  'input-type-not-supported',
  'card-not-in-catalog',
  'ai-player',
  'game-over',
] as const;
export type CoachWarningCode = typeof COACH_WARNING_CODES[number];

/** Counters that identify where in the game history a snapshot was taken. */
export type CoachStateVersion = {
  generation: number,
  phase: Phase,
  /** Grows with every game log line; returns to an earlier value after an undo. */
  gameAge: number,
  /** Id of the last database save (`lastSaveId`); returns to an earlier value after an undo. */
  gameStep: number,
  /**
   * Number of undos and cancelled actions so far.
   *
   * Not strictly monotonic: two undos in a row without a save in between can report the same value.
   */
  undoCount: number,
};

export type ResourceAmounts = Record<Resource, number>;

/** A card in some zone, with the values that depend on the player and game. Static data: catalog. */
export type CoachCardInstance = {
  name: CardName,
  /** Cost after this player's discounts (only for cards in hand, drafted or offered for purchase). */
  calculatedCost?: number,
  /** Resources (animals, microbes, …) on the card; only for cards in a tableau. */
  resources?: number,
  /** Discounts the card grants, as the game currently computes them. */
  discount?: ReadonlyArray<CardDiscount>,
  /** True when the card is temporarily unusable (e.g. Pharmacy Union turned face down). */
  isDisabled?: boolean,
  warnings?: ReadonlyArray<Warning>,
  additionalProjectCosts?: AdditionalProjectCosts,
  reserveUnits?: Readonly<Units>,
  bonusResource?: ReadonlyArray<Resource>,
  cloneTag?: Tag,
  /** False when the name is missing from the coach catalog of this build. */
  inCatalog: boolean,
};

export type CoachGlobalParameter = {
  value: number,
  min: number,
  max: number,
  /** Steps left until the maximum. */
  stepsRemaining: number,
};

export type CoachSpace = {
  id: SpaceId,
  x: number,
  y: number,
  spaceType: string,
  bonus: ReadonlyArray<string>,
  /** Ids of the neighbouring spaces on the same board. */
  adjacent: ReadonlyArray<SpaceId>,
  tile?: {type: string, ownerColor?: Color},
  /** Colour of the owner, also without a tile (land claim). Oceans have no owner. */
  ownerColor?: Color,
  highlight?: 'noctis' | 'volcanic',
};

export type CoachMilestone = {
  name: string,
  claimedBy?: Color,
  threshold?: number,
  /** Empty once the milestone is claimed or all milestones are taken. */
  scores: ReadonlyArray<{color: Color, score: number, claimable: boolean}>,
};

export type CoachAward = {
  name: string,
  fundedBy?: Color,
  /** Empty once all awards are funded and this one is not. */
  scores: ReadonlyArray<{color: Color, score: number}>,
};

export type CoachGameState = {
  name: string,
  mode: 'solo' | 'multiplayer',
  playerCount: number,
  board: string,
  expansions: Readonly<Record<string, boolean>>,
  /** True when only base game (optionally with Corporate Era) is enabled: the scope Phase 1 validates. */
  baseGameOnly: boolean,
  options: {
    draftVariant: boolean,
    initialDraftVariant: boolean,
    preludeDraftVariant: boolean,
    showOtherPlayersVP: boolean,
    undoOption: boolean,
    soloTR: boolean,
    fastModeOption: boolean,
    randomMA: string,
  },
  generation: number,
  phase: Phase,
  /** Last generation of a solo game (14, or 12 with Prelude). */
  lastSoloGeneration: number,
  activePlayer: Color,
  firstPlayer: Color | undefined,
  passedPlayers: ReadonlyArray<Color>,
  temperature: CoachGlobalParameter,
  oxygen: CoachGlobalParameter,
  oceans: CoachGlobalParameter,
  /** Present only with Venus Next. */
  venus?: CoachGlobalParameter,
  isTerraformed: boolean,
  gameOver: boolean,
  /** Solo games only, once the game is over: whether the player won. */
  soloWin?: boolean,
  decks: {
    projectDrawPile: number,
    projectDiscardPile: number,
    corporationDrawPile: number,
    preludeDrawPile?: number,
  },
  spaces: ReadonlyArray<CoachSpace>,
  milestones: ReadonlyArray<CoachMilestone>,
  awards: ReadonlyArray<CoachAward>,
  /** Expansion parts this schema does not normalize; present only when that expansion is on. */
  unsupported: ReadonlyArray<{part: string, reason: string}>,
};

/** What everybody at the table can see about a player. */
export type CoachPublicPlayer = {
  color: Color,
  name: string,
  isAi: boolean,
  isActive: boolean,
  hasPassed: boolean,
  terraformRating: number,
  victoryPoints: Observed<VictoryPointsBreakdown>,
  resources: ResourceAmounts,
  production: ResourceAmounts,
  steelValue: number,
  titaniumValue: number,
  tags: Readonly<Partial<Record<Tag, number>>>,
  cardsWithoutTags: number,
  cardsInHandCount: number,
  /** Corporation cards in front of the player (usually one). */
  corporations: ReadonlyArray<CardName>,
  /** Every card in front of the player, corporations included, with resources on them. */
  tableau: ReadonlyArray<CoachCardInstance>,
  /** Cards whose action was used this generation. */
  actionsUsedThisGeneration: ReadonlyArray<CardName>,
  actionsTakenThisRound: number,
  /** Blue cards whose action could be used now (as the game reports it). */
  availableBlueCardActionCount: number,
  citiesCount: number,
  /** Cost of buying one project card in the research phase. */
  cardCost: number,
  protectedResources: Readonly<Record<Resource, 'off' | 'on' | 'half'>>,
  protectedProduction: Readonly<Record<Resource, 'off' | 'on' | 'half'>>,
  lastCardPlayed?: CardName,
  needsToResearch: boolean | undefined,
  needsToDraft: boolean | undefined,
};

/** Private parts of the requesting player. */
export type CoachSelfPlayer = CoachPublicPlayer & {
  hand: ReadonlyArray<CoachCardInstance>,
  preludesInHand: ReadonlyArray<CoachCardInstance>,
  ceosInHand: ReadonlyArray<CoachCardInstance>,
  /** Cards drafted this generation, not yet bought. */
  draftedCards: ReadonlyArray<CoachCardInstance>,
  /**
   * Cards dealt for the opening choice (corporations, preludes, projects).
   *
   * The game keeps these lists after the choice is made: they are history, not the current offer.
   * What may be picked now is only in `choices`.
   */
  dealt: {
    corporations: ReadonlyArray<CoachCardInstance>,
    preludes: ReadonlyArray<CoachCardInstance>,
    projects: ReadonlyArray<CoachCardInstance>,
    ceos: ReadonlyArray<CoachCardInstance>,
  },
  pickedCorporation: ReadonlyArray<CardName>,
  autopass: boolean,
  canCancelAction: boolean,
};

/** One node of the question the player must answer now (a normalized PlayerInputModel). */
export type CoachChoice = {
  /**
   * Position in the input tree: `""` for the root, `"2"` for option 2 of the root, `"2.0"` below it.
   *
   * The same indexes the game expects in the answer (`or.index`, `and.responses`).
   */
  path: string,
  inputType: string,
  title: string,
  buttonLabel: string,
  optional: boolean,
  /** Present when the question has nested options (`or`, `and`, `initialCards`). */
  options?: ReadonlyArray<CoachChoice>,
  /** For `or`: option pre-selected by the client. */
  initialIndex?: number,
  /** Cards offered by `card` / `projectCard` (only these may be picked). */
  cards?: ReadonlyArray<CoachCardInstance>,
  min?: number,
  max?: number,
  /** For `card`: true when the choice uses a blue card action. */
  selectBlueCardAction?: boolean,
  /** For `space`: spaces that are legal now. */
  spaces?: ReadonlyArray<SpaceId>,
  tile?: string,
  /** For `payment` / `projectCard`. */
  amount?: number,
  paymentOptions?: Partial<PaymentOptions>,
  /** Resources on cards the player may spend instead of M€ (microbes, floaters, …). */
  spendableCardResources?: Readonly<Record<string, number>>,
  /** For `player`: colours that may be chosen. */
  players?: ReadonlyArray<Color>,
  /** For `amount`. */
  maxByDefault?: boolean,
  /** For `resource` / `resources`. */
  include?: ReadonlyArray<string>,
  count?: number,
  warnings?: ReadonlyArray<string>,
  /** True when this node type is passed through without normalization. */
  unsupported?: boolean,
};

export type CoachChoices =
  /** The player must (or may) answer `root` now. These are the only legal choices at this moment. */
  {status: 'awaiting-input', root: CoachChoice, sourceCard?: CardName} |
  /** Another player is acting; nothing for this player to do. */
  {status: 'waiting-for-others', waitingFor: ReadonlyArray<Color>} |
  /** Nobody has a question: the game is resolving automatic steps (e.g. the final production). */
  {status: 'resolving'} |
  {status: 'game-over'};

export type CoachStateV1 = {
  schemaVersion: typeof COACH_STATE_SCHEMA,
  /**
   * Hash of the game content (no time, version counters, timers, warnings or cancel option).
   *
   * Stable across restarts: use it to key facts derived from the position (strategy calculations).
   */
  fingerprint: string,
  /**
   * Hash of everything a piece of advice depends on: the content plus warnings and whether the action
   * can still be cancelled. No time, version counters or timers.
   *
   * May change while `fingerprint` stays equal (a warning appears or disappears, e.g. after a restart).
   * Recompute advice about the current choices when it changes. Added in Phase 1.5 (absent in older
   * snapshots).
   */
  advisoryFingerprint: string,
  /** Position in history: equal content reached through an undo gets a different `stateKey`. */
  stateKey: string,
  version: CoachStateVersion,
  /** Build of the card catalog the names refer to (`GET /api/coach/catalog`). */
  catalogVersion: string,
  /** ISO time of capture. Not part of the fingerprint. */
  capturedAt: string,
  warnings: ReadonlyArray<CoachWarning>,
  game: CoachGameState,
  me: CoachSelfPlayer,
  /** Other players in generation order, public information only. */
  opponents: ReadonlyArray<CoachPublicPlayer>,
  choices: CoachChoices,
};
