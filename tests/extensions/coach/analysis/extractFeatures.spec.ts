import {expect} from 'chai';
import {extractMechanics} from '../../../../src/extensions/coach/server/analysis/extractFeatures';
import {allMechanics, mechanicsOf} from '../../../../src/extensions/coach/server/analysis/mechanicsCatalog';
import {catalogCard, getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardMechanics} from '../../../../src/extensions/coach/common/CoachMechanics';
import {CoachCatalogCard} from '../../../../src/extensions/coach/common/CoachCatalog';
import {CardType} from '../../../../src/common/cards/CardType';
import {Tag} from '../../../../src/common/cards/Tag';

function mechanics(name: CardName): CardMechanics {
  const result = mechanicsOf(name);
  expect(result, name).is.not.undefined;
  return result!;
}

// Gate A: effect atoms and the explicit list of what is not modeled
describe('coach analysis extractFeatures', () => {
  it('turns fixed effects into atoms (Algae)', () => {
    const algae = mechanics(CardName.ALGAE);
    expect(algae.support).eq('supported');
    expect(algae.atoms).deep.eq([
      {kind: 'production', source: 'onPlay', resource: 'plants', amount: 2},
      {kind: 'stock', source: 'onPlay', resource: 'plants', amount: 1},
    ]);
    expect(algae.requirements).deep.eq([{kind: 'global', parameter: 'oceans', count: 5, max: false}]);
  });

  it('reads discounts and requirement bonuses', () => {
    expect(mechanics(CardName.EARTH_OFFICE).atoms).deep.eq([{kind: 'cardDiscount', source: 'static', tag: Tag.EARTH, amount: 3, per: 'tag'}]);
    expect(mechanics(CardName.SPACE_STATION).atoms).deep.include({kind: 'cardDiscount', source: 'static', tag: Tag.SPACE, amount: 2, per: 'tag'});
    expect(mechanics(CardName.EARTH_CATAPULT).atoms).deep.include({kind: 'cardDiscount', source: 'static', tag: undefined, amount: 2, per: 'tag'});
    expect(mechanics(CardName.SPECIAL_DESIGN).atoms).deep.include({kind: 'requirementBonus', source: 'static', steps: 2, nextCardOnly: true});
  });

  // P2-11
  it('models victory points per resource (Tardigrades)', () => {
    const tardigrades = mechanics(CardName.TARDIGRADES);
    expect(tardigrades.atoms).deep.eq([
      {kind: 'addResourcesHere', source: 'action', count: 1},
      {kind: 'victoryPointsPerResource', source: 'victoryPoints', points: 1, per: 4},
    ]);
    expect(tardigrades.support).eq('supported');
  });

  // P2-12, P2-19
  it('never turns card code or formulas into numbers (Media Group, Countable)', () => {
    const media = mechanics(CardName.MEDIA_GROUP);
    expect(media.support).not.eq('supported');
    expect(media.unmodeled.map((u) => [u.kind, u.key])).deep.include(['bespoke-code', 'onCardPlayed']);
    expect(media.atoms.some((a) => a.kind === 'stock')).is.false;

    const countables = allMechanics().filter((m) => m.unmodeled.some((u) => u.kind === 'countable'));
    expect(countables.length).greaterThan(0);
    for (const m of countables) {
      expect(m.support, m.name).is.oneOf(['partial', 'unsupported']);
    }
  });

  it('reports unknown behavior keys', () => {
    const algae = catalogCard(CardName.ALGAE)!;
    const fake: CoachCatalogCard = {...algae, effects: {...algae.effects, onPlay: {production: {plants: 1}, mysteryEffect: 3}}};
    const result = extractMechanics(fake);
    expect(result.support).eq('partial');
    expect(result.unmodeled).deep.include({source: 'onPlay', kind: 'unknown-key', key: 'mysteryEffect', reason: 'behavior key \'mysteryEffect\' is not known to the analysis'});
  });

  it('classifies every base and Corporate Era card without hiding gaps', () => {
    const cards = getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') && c.type !== CardType.PROXY);
    expect(cards.length).greaterThan(200);
    for (const card of cards) {
      const m = mechanics(card.name);
      expect(['supported', 'partial', 'unsupported', 'none'], card.name).includes(m.support);
      // A card with card-specific code that changes its effects is never fully supported.
      const effectHooks = card.effects.bespokeHooks.filter((h) => !['bespokeCanPlay', 'canPlay', 'getAvailableSpaces', 'spaceSelected', 'getTileType', 'getAdjacencyBonus', 'title'].includes(h));
      if (effectHooks.length > 0) {
        expect(m.support, card.name).not.eq('supported');
      }
      for (const u of m.unmodeled) {
        expect(u.reason.length, `${card.name} ${u.key}`).greaterThan(0);
      }
      // No unknown keys in the current cards: a new key would show up here first.
      expect(m.unmodeled.filter((u) => u.kind === 'unknown-key'), card.name).is.empty;
    }
  });
});
