import {CardModel} from '@/common/models/CardModel';
import {CoachCardInstance} from '../common/CoachState';
import {isInCatalog} from './cardCatalog';

/** Copies the game-dependent fields of a CardModel; `undefined` fields are left out. */
export function toCardInstance(model: CardModel): CoachCardInstance {
  const card: CoachCardInstance = {name: model.name, inCatalog: isInCatalog(model.name)};
  if (model.calculatedCost !== undefined) {
    card.calculatedCost = model.calculatedCost;
  }
  if (model.resources !== undefined) {
    card.resources = model.resources;
  }
  if (model.discount !== undefined && model.discount.length > 0) {
    card.discount = model.discount;
  }
  if (model.isDisabled === true) {
    card.isDisabled = true;
  }
  if (model.warnings !== undefined && model.warnings.length > 0) {
    card.warnings = model.warnings;
  }
  if (model.additionalProjectCosts !== undefined) {
    card.additionalProjectCosts = model.additionalProjectCosts;
  }
  if (model.reserveUnits !== undefined) {
    card.reserveUnits = model.reserveUnits;
  }
  if (model.bonusResource !== undefined && model.bonusResource.length > 0) {
    card.bonusResource = model.bonusResource;
  }
  if (model.cloneTag !== undefined) {
    card.cloneTag = model.cloneTag;
  }
  return card;
}

export function toCardInstances(models: ReadonlyArray<CardModel>): Array<CoachCardInstance> {
  return models.map(toCardInstance);
}
