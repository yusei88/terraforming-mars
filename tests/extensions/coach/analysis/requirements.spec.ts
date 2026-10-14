import {expect} from 'chai';
import {analyzeRequirements, requirementsMet} from '../../../../src/extensions/coach/server/analysis/requirements';
import {mechanicsOf} from '../../../../src/extensions/coach/server/analysis/mechanicsCatalog';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {getCatalog} from '../../../../src/extensions/coach/server/cardCatalog';
import {testGame} from '../../../TestGame';
import {TestPlayer} from '../../../TestPlayer';
import {IGame} from '../../../../src/server/IGame';
import {CardName} from '../../../../src/common/cards/CardName';
import {CardType} from '../../../../src/common/cards/CardType';
import {Phase} from '../../../../src/common/Phase';
import {Tag} from '../../../../src/common/cards/Tag';
import {newCard} from '../../../../src/server/createCard';
import {Card} from '../../../../src/server/cards/Card';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {CardRequirements} from '../../../../src/server/cards/requirements/CardRequirements';
import {addCity, addGreenery, maxOutOceans, setOxygenLevel, setTemperature} from '../../../TestingUtils';
import {Algae} from '../../../../src/server/cards/base/Algae';
import {ArcticAlgae} from '../../../../src/server/cards/base/ArcticAlgae';
import {AdaptationTechnology} from '../../../../src/server/cards/base/AdaptationTechnology';
import {SpecialDesign} from '../../../../src/server/cards/base/SpecialDesign';
import {ResearchCoordination} from '../../../../src/server/cards/prelude/ResearchCoordination';

function gaps(player: TestPlayer, card: CardName) {
  return analyzeRequirements(projectCoachState(player), mechanicsOf(card)!);
}

/* The engine's own requirement check (no affordability, no card code). */
function engineSatisfies(player: TestPlayer, name: CardName): boolean {
  const card = newCard(name) as IProjectCard & Card;
  const compiled = (card as unknown as {properties: {compiledRequirements: CardRequirements}}).properties.compiledRequirements;
  return compiled.satisfies(player, card);
}

/* Cards of base and Corporate Era whose tags make a varied tableau. */
function cardWithTag(tag: Tag, exclude: Set<CardName>): IProjectCard {
  const entry = getCatalog().cards.find((c) => (c.module === 'base' || c.module === 'corpera') &&
    (c.type === CardType.AUTOMATED || c.type === CardType.ACTIVE) && c.tags.includes(tag) && !exclude.has(c.name));
  if (entry === undefined) {
    throw new Error(`no card with tag ${tag}`);
  }
  exclude.add(entry.name);
  return newCard(entry.name) as IProjectCard;
}

describe('coach analysis requirements', () => {
  // P2-05
  it('finds the missing ocean of Algae and agrees with the offered choices', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    game.phase = Phase.ACTION;
    player.megaCredits = 30;
    player.cardsInHand.push(new Algae());
    maxOutOceans(player, 4);
    expect(gaps(player, CardName.ALGAE)).deep.eq([{
      kind: 'oceans', observed: 4, target: 5, comparator: '>=', gap: 1, status: 'unmet',
      evidence: [
        {kind: 'state', fieldPath: 'game.oceans.value', stateFingerprint: projectCoachState(player).fingerprint},
        {kind: 'catalog', fieldPath: 'requirements[0]', cardName: CardName.ALGAE},
      ],
    }]);
    player.takeAction();
    const offered = (state: ReturnType<typeof projectCoachState>) =>
      state.choices.status === 'awaiting-input' ? state.choices.root.options?.find((o) => o.inputType === 'projectCard')?.cards?.map((c) => c.name) ?? [] : [];
    expect(offered(projectCoachState(player))).does.not.include(CardName.ALGAE);

    maxOutOceans(player, 5);
    player.popWaitingFor();
    player.takeAction();
    expect(gaps(player, CardName.ALGAE)[0]).deep.include({observed: 5, gap: 0, status: 'met'});
    expect(offered(projectCoachState(player))).includes(CardName.ALGAE);
  });

  // P2-07
  it('reads maximum requirements and marks them permanently unmet once exceeded', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    expect(gaps(player, CardName.ARCTIC_ALGAE)[0]).deep.include({kind: 'temperature', comparator: '<=', target: -12, status: 'met', gap: 0});
    setTemperature(game, -10);
    const exceeded = gaps(player, CardName.ARCTIC_ALGAE)[0];
    expect(exceeded).deep.include({observed: -10, status: 'unmet', gap: 1, permanentlyUnmet: true});
    expect(engineSatisfies(player, CardName.ARCTIC_ALGAE)).is.false;
    expect(new ArcticAlgae().name).eq(CardName.ARCTIC_ALGAE);
  });

  it('applies requirement bonuses like the engine (Adaptation Technology, Special Design)', () => {
    const [game, player] = testGame(1, {skipInitialCardSelection: true});
    setTemperature(game, -16);
    // Arctic Algae: max -12 °C. With 2 steps of bonus a maximum gains 4 °C of room.
    player.playedCards.push(new AdaptationTechnology());
    setTemperature(game, -10);
    expect(gaps(player, CardName.ARCTIC_ALGAE)[0]).deep.include({observed: -14, status: 'met'});
    expect(engineSatisfies(player, CardName.ARCTIC_ALGAE)).is.true;

    // Special Design helps only the next card.
    const [, other] = testGame(1, {skipInitialCardSelection: true});
    const design = new SpecialDesign();
    other.playedCards.push(design);
    maxOutOceans(other, 3);
    expect(gaps(other, CardName.ALGAE)[0]).deep.include({observed: 3, status: 'unmet'});
    other.lastCardPlayed = design.name;
    expect(gaps(other, CardName.ALGAE)[0]).deep.include({observed: 5, status: 'met'});
    expect(engineSatisfies(other, CardName.ALGAE)).is.true;
  });

  // P2-06
  it('counts wild tags for minimum tag requirements only', () => {
    const [, player] = testGame(1, {skipInitialCardSelection: true});
    const science = getCatalog().cards
      .filter((c) => c.module === 'base' && c.requirements.some((r) => r.tag === Tag.SCIENCE && r.max !== true))
      .sort((a, b) => (a.requirements[0].count ?? 1) - (b.requirements[0].count ?? 1))[0];
    const needed = science.requirements.find((r) => r.tag === Tag.SCIENCE)?.count ?? 1;
    const used = new Set<CardName>([science.name]);
    for (let i = 0; i < needed - 1; i++) {
      player.playedCards.push(cardWithTag(Tag.SCIENCE, used));
    }
    expect(gaps(player, science.name)[0]).deep.include({kind: 'tag', observed: needed - 1, gap: 1, status: 'unmet'});
    expect(engineSatisfies(player, science.name)).is.false;
    player.playedCards.push(new ResearchCoordination());
    expect(gaps(player, science.name)[0]).deep.include({kind: 'tag', observed: needed, gap: 0, status: 'met'});
    expect(engineSatisfies(player, science.name)).is.true;
  });

  // Every evaluated requirement of base and Corporate Era cards against the engine, in several games.
  it('agrees with the engine for every evaluated requirement', () => {
    const scenarios: Array<{label: string, setup: (game: IGame, player: TestPlayer) => void}> = [
      {label: 'start', setup: () => {}},
      {label: 'mid', setup: (game, player) => {
        setTemperature(game, -10);
        setOxygenLevel(game, 6);
        maxOutOceans(player, 4);
        const used = new Set<CardName>();
        for (const tag of [Tag.SCIENCE, Tag.SCIENCE, Tag.SCIENCE, Tag.EARTH, Tag.EARTH, Tag.SPACE, Tag.PLANT, Tag.MICROBE, Tag.ANIMAL, Tag.POWER, Tag.POWER, Tag.JOVIAN, Tag.BUILDING]) {
          player.playedCards.push(cardWithTag(tag, used));
        }
        player.production.override({megacredits: 2, steel: 1, titanium: 1, plants: 2, energy: 2, heat: 1});
        addGreenery(player);
        addCity(player);
      }},
      {label: 'late', setup: (game, player) => {
        setTemperature(game, 8);
        setOxygenLevel(game, 14);
        maxOutOceans(player, 9);
        player.playedCards.push(new AdaptationTechnology());
      }},
    ];
    const cards = getCatalog().cards.filter((c) => (c.module === 'base' || c.module === 'corpera') &&
      (c.type === CardType.AUTOMATED || c.type === CardType.ACTIVE || c.type === CardType.EVENT) && c.requirements.length > 0);
    let compared = 0;
    for (const scenario of scenarios) {
      const [game, player] = testGame(2, {skipInitialCardSelection: true});
      scenario.setup(game, player);
      for (const card of cards) {
        const met = requirementsMet(gaps(player, card.name));
        if (met === 'unknown') {
          continue;
        }
        expect(met, `${scenario.label}: ${card.name}`).eq(engineSatisfies(player, card.name));
        compared++;
      }
    }
    expect(compared).greaterThan(150);
  }).timeout(30_000);
});
