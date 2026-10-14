import {expect} from 'chai';
import {buildCatalog, getCatalog, isInCatalog} from '../../../src/extensions/coach/server/cardCatalog';
import {ALL_MODULE_MANIFESTS} from '../../../src/server/cards/AllManifests';
import {CardManifest} from '../../../src/server/cards/ModuleManifest';
import {ICard} from '../../../src/server/cards/ICard';
import {CardName} from '../../../src/common/cards/CardName';
import {CardType} from '../../../src/common/cards/CardType';
import {Tag} from '../../../src/common/cards/Tag';
import {CoachCatalogCard} from '../../../src/extensions/coach/common/CoachCatalog';
import {BASE_CARD_MANIFEST} from '../../../src/server/cards/StandardCardManifests';

// S24: card catalog coverage
describe('coach cardCatalog', () => {
  const byName = new Map(getCatalog().cards.map((card) => [card.name, card]));
  function card(name: CardName): CoachCatalogCard {
    const entry = byName.get(name);
    expect(entry, name).is.not.undefined;
    return entry!;
  }

  it('lists every card of every module manifest exactly once', () => {
    const expected = new Set<CardName>();
    for (const manifest of ALL_MODULE_MANIFESTS) {
      const decks: ReadonlyArray<CardManifest<ICard>> = [
        manifest.projectCards, manifest.corporationCards, manifest.preludeCards, manifest.ceoCards, manifest.standardProjects, manifest.standardActions,
      ];
      for (const deck of decks) {
        for (const factory of CardManifest.values(deck)) {
          const instance = new factory.Factory();
          // Proxy cards are not real cards and are left out.
          if (instance.type !== CardType.PROXY) {
            expected.add(instance.name);
          }
        }
      }
    }
    const names = getCatalog().cards.map((c) => c.name);
    expect(new Set(names).size).eq(names.length);
    expect(new Set(names)).deep.eq(expected);
    for (const name of expected) {
      expect(isInCatalog(name), name).is.true;
    }
  });

  it('identifies every base game card', () => {
    const baseNames = [
      ...CardManifest.keys(BASE_CARD_MANIFEST.projectCards),
      ...CardManifest.keys(BASE_CARD_MANIFEST.corporationCards),
      ...CardManifest.keys(BASE_CARD_MANIFEST.standardProjects),
      ...CardManifest.keys(BASE_CARD_MANIFEST.standardActions),
    ];
    expect(baseNames.length).greaterThan(150);
    for (const name of baseNames) {
      expect(card(name).module, name).eq('base');
    }
  });

  it('is plain JSON and stable between builds', () => {
    const a = buildCatalog();
    const b = buildCatalog();
    expect(a.catalogVersion).eq(b.catalogVersion);
    expect(JSON.parse(JSON.stringify(a))).deep.eq(a);
    expect(a.schemaVersion).eq('coach-catalog/1');
  });

  it('keeps static card facts', () => {
    const catapult = card(CardName.EARTH_CATAPULT);
    expect(catapult.cost).eq(23);
    expect(catapult.tags).deep.eq([Tag.EARTH]);
    expect(catapult.victoryPoints).eq(2);
    expect(catapult.cardDiscount).deep.eq({amount: 2});

    const station = card(CardName.SPACE_STATION);
    expect(station.cardDiscount).deep.eq({tag: Tag.SPACE, amount: 2});
    expect(station.victoryPoints).eq(1);

    const tardigrades = card(CardName.TARDIGRADES);
    expect(tardigrades.resourceType).eq('Microbe');
    expect(tardigrades.effects.hasAction).is.true;
  });

  it('describes declarative effects and flags bespoke code', () => {
    // Algae: purely declarative play behavior, with a requirement.
    const algae = card(CardName.ALGAE);
    expect(algae.requirements).has.length(1);
    expect(algae.effects.playCoverage).eq('declarative');
    expect(algae.effects.onPlay).deep.eq({production: {plants: 2}, stock: {plants: 1}});
    expect(algae.effects.bespokeHooks).is.empty;

    // Tardigrades: declarative action.
    expect(card(CardName.TARDIGRADES).effects.actionCoverage).eq('declarative');

    // Pets: the effect lives in code; the catalog must say so instead of guessing.
    const pets = card(CardName.PETS);
    expect(pets.effects.bespokeHooks).includes('onTilePlaced');

    // Earth Office: a tag discount, machine-readable.
    expect(card(CardName.EARTH_OFFICE).cardDiscount).deep.eq({tag: Tag.EARTH, amount: 3});
    // Tardigrades VP are per resource: countable, not 'special'.
    expect(card(CardName.TARDIGRADES).victoryPoints).deep.eq({resourcesHere: {}, per: 4});
  });

  it('exports effects declared as card properties', () => {
    expect(card(CardName.ADAPTATION_TECHNOLOGY).effects.staticEffects.globalParameterRequirementBonus).deep.eq({steps: 2});
    expect(card(CardName.SPECIAL_DESIGN).effects.staticEffects.globalParameterRequirementBonus).deep.eq({steps: 2, nextCardOnly: true});
    expect(card(CardName.CAPITAL).effects.staticEffects.tilesBuilt).includes('CAPITAL');
  });

  it('leaves no base card effect unaccounted for', () => {
    // A base card with no Behavior, no static effect and no bespoke code must be worth only its VP.
    const silent = getCatalog().cards
      .filter((c) => c.module === 'base' && c.type !== CardType.STANDARD_PROJECT && c.type !== CardType.STANDARD_ACTION)
      .filter((c) => c.effects.playCoverage === 'none' && !c.effects.hasAction && c.effects.bespokeHooks.length === 0 &&
        Object.values(c.effects.staticEffects).every((v) => v === undefined || v === false) && c.cardDiscount === undefined)
      .map((c) => c.name);
    expect(silent.sort()).deep.eq([CardName.ADVANCED_ECOSYSTEMS, CardName.BREATHING_FILTERS, CardName.COLONIZER_TRAINING_CAMP, CardName.DUST_SEALS].sort());
    for (const name of silent) {
      expect(card(name).victoryPoints, name).is.a('number');
    }
  });

  it('keeps Behavior data free of functions', () => {
    const hasFunction = (value: unknown): boolean => typeof value === 'function' ||
      (typeof value === 'object' && value !== null && Object.values(value).some(hasFunction));
    for (const factory of ALL_MODULE_MANIFESTS.flatMap((m) => [...CardManifest.values(m.projectCards), ...CardManifest.values(m.corporationCards), ...CardManifest.values(m.preludeCards)])) {
      const instance = new factory.Factory();
      expect(hasFunction(instance.behavior), instance.name).is.false;
    }
  });

  it('separates display text from machine data', () => {
    const algae = card(CardName.ALGAE);
    expect(algae.display.description).is.a('string');
    expect(algae.display.cardNumber).eq('047');
    expect(Object.keys(algae)).does.not.include('metadata');
  });

  it('marks how complete the effect data is for the base game', () => {
    const base = getCatalog().cards.filter((c) => c.module === 'base' && c.type !== CardType.STANDARD_PROJECT && c.type !== CardType.STANDARD_ACTION);
    const counts: Record<string, number> = {};
    for (const c of base) {
      counts[c.effects.playCoverage] = (counts[c.effects.playCoverage] ?? 0) + 1;
    }
    // Every card gets a classification; none is silently skipped.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).eq(base.length);
    expect(counts.declarative).greaterThan(0);
  });
});
