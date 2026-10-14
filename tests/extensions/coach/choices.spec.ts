import {expect} from 'chai';
import {messageText, toChoice} from '../../../src/extensions/coach/server/choices';
import {CoachWarning} from '../../../src/extensions/coach/common/CoachState';
import {PlayerInputModel} from '../../../src/common/models/PlayerInputModel';
import {CardName} from '../../../src/common/cards/CardName';
import {LogMessageDataType} from '../../../src/common/logs/LogMessageDataType';
import {TileType} from '../../../src/common/TileType';
import {SpaceId} from '../../../src/common/Types';

const base = {buttonLabel: 'OK'};

// S19: nested and multi-step inputs
describe('coach choices', () => {
  it('keeps the paths of nested or/and options', () => {
    const model: PlayerInputModel = {
      ...base, type: 'or', title: 'Take your next action', initialIdx: 1,
      options: [
        {...base, type: 'option', title: 'Pass for this generation'},
        {...base, type: 'and', title: 'Both',
          options: [
            {...base, type: 'amount', title: 'Amount', min: 0, max: 4, maxByDefault: false},
            {...base, type: 'space', title: 'Select space for city tile', spaces: ['04' as SpaceId, '05' as SpaceId], tile: {type: TileType.CITY}},
          ]},
      ],
    };
    const warnings: Array<CoachWarning> = [];
    const choice = toChoice(model, '', warnings);
    expect(choice.path).eq('');
    expect(choice.initialIndex).eq(1);
    expect(choice.options?.map((o) => o.path)).deep.eq(['0', '1']);
    const and = choice.options![1];
    expect(and.options?.map((o) => o.path)).deep.eq(['1.0', '1.1']);
    expect(and.options?.[0]).deep.include({inputType: 'amount', min: 0, max: 4, maxByDefault: false});
    expect(and.options?.[1]).deep.include({inputType: 'space', spaces: ['04', '05'], tile: 'CITY'});
    expect(warnings).is.empty;
  });

  it('lists the cards and payment of a card to play', () => {
    const model: PlayerInputModel = {
      ...base, type: 'projectCard', title: 'Play project card',
      cards: [{name: CardName.ASTEROID, calculatedCost: 12}],
      paymentOptions: {steel: false, titanium: true},
      microbes: 0, floaters: 2, lunaArchivesScience: 0, seeds: 0, graphene: 0, kuiperAsteroids: 0, auroraiData: 0, spireScience: 0,
    };
    const choice = toChoice(model, '3', []);
    expect(choice.cards).deep.eq([{name: CardName.ASTEROID, calculatedCost: 12, inCatalog: true}]);
    expect(choice.paymentOptions).deep.eq({steel: false, titanium: true});
    expect(choice.spendableCardResources).deep.eq({floaters: 2});
  });

  it('describes payment and card selection', () => {
    const payment = toChoice({
      ...base, type: 'payment', title: 'Pay', amount: 8, paymentOptions: {heat: true},
      seeds: 0, auroraiData: 0, kuiperAsteroids: 0, spireScience: 0, reserveUnits: undefined, floaters: 0, microbes: 0, graphene: 0,
    }, '', []);
    expect(payment).deep.include({amount: 8, paymentOptions: {heat: true}});
    expect(payment.spendableCardResources).is.undefined;

    const card = toChoice({
      ...base, type: 'card', title: 'Select card(s) to buy', cards: [{name: CardName.ALGAE}],
      min: 0, max: 1, showOnlyInLearnerMode: false, selectBlueCardAction: false, showOwner: false, showSelectAll: false,
    }, '', []);
    expect(card).deep.include({min: 0, max: 1, selectBlueCardAction: false});
  });

  it('renders message titles as text', () => {
    expect(messageText('plain')).eq('plain');
    expect(messageText({message: 'Remove ${0} from ${1}', data: [
      {type: LogMessageDataType.STRING, value: '2'},
      {type: LogMessageDataType.CARD, value: CardName.ANTS},
    ]})).eq('Remove 2 from Ants');
  });

  it('flags input types it does not normalize', () => {
    const warnings: Array<CoachWarning> = [];
    const choice = toChoice({...base, type: 'party', title: 'Select party', parties: []}, '2', warnings);
    expect(choice.unsupported).is.true;
    expect(warnings).has.length(1);
    expect(warnings[0].code).eq('input-type-not-supported');
  });
});
