import {PlayerInputModel} from '@/common/models/PlayerInputModel';
import {Message} from '@/common/logs/Message';
import {Log} from '@/common/logs/Log';
import {LogMessageData} from '@/common/logs/LogMessageData';
import {LogMessageDataType} from '@/common/logs/LogMessageDataType';
import {TileType} from '@/common/TileType';
import {SpaceBonus} from '@/common/boards/SpaceBonus';
import {CoachChoice, CoachWarning} from '../common/CoachState';
import {toCardInstances} from './cardInstances';

function datumText(datum: LogMessageData | undefined): string {
  if (datum === undefined) {
    return '';
  }
  switch (datum.type) {
  case LogMessageDataType.TILE_TYPE:
    return TileType[datum.value] ?? String(datum.value);
  case LogMessageDataType.SPACE_BONUS:
    return SpaceBonus[datum.value] ?? String(datum.value);
  case LogMessageDataType.CARDS:
    return datum.value.join(', ');
  default:
    return String(datum.value);
  }
}

/** Plain English text of a game message with its placeholders filled in. */
export function messageText(message: string | Message): string {
  return typeof message === 'string' ? message : Log.applyData(message, datumText);
}

function spendableCardResources(model: {[key: string]: unknown}, keys: ReadonlyArray<string>): Record<string, number> | undefined {
  const result: Record<string, number> = {};
  for (const key of keys) {
    const value = model[key];
    if (typeof value === 'number' && value > 0) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const PROJECT_CARD_RESOURCES = ['microbes', 'floaters', 'lunaArchivesScience', 'seeds', 'graphene', 'kuiperAsteroids', 'auroraiData', 'spireScience'];
const PAYMENT_RESOURCES = ['seeds', 'auroraiData', 'kuiperAsteroids', 'spireScience', 'floaters', 'microbes', 'graphene'];

/**
 * Normalizes the input tree the player is asked to answer now.
 *
 * Every node keeps its `path` (indexes into the tree), so an answer can later be built for exactly one of
 * the offered options. Input types without a normalization are kept with `unsupported: true` and a warning.
 */
export function toChoice(model: PlayerInputModel, path: string, warnings: Array<CoachWarning>): CoachChoice {
  const choice: CoachChoice = {
    path,
    inputType: model.type,
    title: messageText(model.title),
    buttonLabel: model.buttonLabel,
    optional: model.optional === true,
  };
  if (model.warning !== undefined) {
    choice.warnings = [messageText(model.warning)];
  }
  const child = (index: number) => (path === '' ? String(index) : `${path}.${index}`);

  switch (model.type) {
  case 'or':
    choice.options = model.options.map((option, index) => toChoice(option, child(index), warnings));
    if (model.initialIdx !== undefined) {
      choice.initialIndex = model.initialIdx;
    }
    break;
  case 'and':
  case 'initialCards':
    choice.options = model.options.map((option, index) => toChoice(option, child(index), warnings));
    break;
  case 'option':
    if (model.warnings !== undefined && model.warnings.length > 0) {
      choice.warnings = [...(choice.warnings ?? []), ...model.warnings];
    }
    break;
  case 'card':
    choice.cards = toCardInstances(model.cards);
    choice.min = model.min;
    choice.max = model.max;
    choice.selectBlueCardAction = model.selectBlueCardAction;
    break;
  case 'projectCard':
    choice.cards = toCardInstances(model.cards);
    choice.paymentOptions = model.paymentOptions;
    choice.spendableCardResources = spendableCardResources(model, PROJECT_CARD_RESOURCES);
    break;
  case 'space':
    choice.spaces = model.spaces;
    if (model.tile !== undefined) {
      choice.tile = TileType[model.tile.type];
    }
    break;
  case 'payment':
    choice.amount = model.amount;
    choice.paymentOptions = model.paymentOptions;
    choice.spendableCardResources = spendableCardResources(model, PAYMENT_RESOURCES);
    break;
  case 'player':
    choice.players = model.players;
    break;
  case 'amount':
    choice.min = model.min;
    choice.max = model.max;
    choice.maxByDefault = model.maxByDefault;
    break;
  case 'resource':
    choice.include = model.include;
    break;
  case 'resources':
    choice.count = model.count;
    break;
  default:
    choice.unsupported = true;
    warnings.push({
      code: 'input-type-not-supported',
      message: `Input type '${model.type}' is passed without normalization`,
      path: `choices.root${path === '' ? '' : ' @ ' + path}`,
    });
  }
  return choice;
}
