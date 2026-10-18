import {expect} from 'chai';
import {Game} from '../../../../src/server/Game';
import {CoachTracer, memorySink, setCoachTracer} from '../../../../src/extensions/coach/server/coachTrace';
import {projectCoachState} from '../../../../src/extensions/coach/server/projectCoachState';
import {buildFindings, evaluate} from '../../../../src/extensions/coach/server/solo/evaluator';
import {canPayInOrder, EvaluatedEvent} from '../../../../src/extensions/coach/server/solo/evidence';
import {ApiCoachFindings} from '../../../../src/extensions/coach/server/routes';
import {CoachFindingsV1, CoachFindingV1} from '../../../../src/extensions/coach/common/CoachFindings';
import {CoachStateV1} from '../../../../src/extensions/coach/common/CoachState';
import {CardName} from '../../../../src/common/cards/CardName';
import {IPlayer} from '../../../../src/server/IPlayer';
import {IProjectCard} from '../../../../src/server/cards/IProjectCard';
import {newCard} from '../../../../src/server/createCard';
import {statusCode} from '../../../../src/common/http/statusCode';
import {RouteTestScaffolding} from '../../../routes/RouteTestScaffolding';
import {MockResponse} from '../../../routes/HttpMocks';
import {TestPlayer} from '../../../TestPlayer';
import {setTemperature} from '../../../TestingUtils';
import {expectNoSecretIds} from '../coachTestUtils';
import {act, newSolo, optionIndex, play, setHand, withoutCorporation} from './soloTestUtils';
import {Payment} from '../../../../src/common/inputs/Payment';

function findings(tracer: CoachTracer | undefined, player: IPlayer): CoachFindingsV1 {
  const state = projectCoachState(player);
  return buildFindings({tracer, gameId: player.game.id, color: player.color, state, history: () => 'valid'});
}

function ofKind(f: CoachFindingsV1, kind: CoachFindingV1['kind']): Array<CoachFindingV1> {
  return f.findings.filter((x) => x.kind === kind);
}

/** A synthetic event of the current line of play with a real snapshot. */
function event(seq: number, kind: string, cards: Array<string>, beforeState: CoachStateV1, extra: Partial<EvaluatedEvent> = {}): EvaluatedEvent {
  return {id: `s${seq}`, seq, kind, generation: beforeState.game.generation, phase: beforeState.game.phase, series: 'current', cards, verified: true, beforeState, ...extra};
}

// P3-SOLO-2: decisions that could have been better, with evidence.
describe('solo strategy evaluation (P3-SOLO-2)', () => {
  let tracer: CoachTracer;

  beforeEach(() => {
    tracer = new CoachTracer(memorySink());
  });

  afterEach(() => setCoachTracer(undefined));

  describe('A. play order and discounts', () => {
    it('finds the discount Earth Office would have given Sponsors, and the engine agrees', () => {
      const {player} = newSolo(undefined, 'solo-ev-order');
      setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
      play(tracer, player, CardName.SPONSORS);
      play(tracer, player, CardName.EARTH_OFFICE);
      const [finding] = ofKind(findings(tracer, player), 'play-order-discount');
      expect(finding).to.deep.include({confidence: 'verified', intervention: true, severity: 'notable'});
      expect(finding.actual.megacredits).eq(7);
      expect(finding.alternative.megacredits).eq(4);
      expect(finding.difference).deep.eq({megacredits: 3});
      expect(finding.evidence.map((e) => e.kind)).deep.eq(['cost', 'offered', 'discount', 'cost', 'resources', 'payment-check']);

      // Golden: the other order in the real engine costs exactly what the finding says.
      const {player: other} = newSolo(undefined, 'solo-ev-order-golden');
      setHand(other, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
      play(tracer, other, CardName.EARTH_OFFICE);
      const sponsors = other.cardsInHand.find((c) => c.name === CardName.SPONSORS) as IProjectCard;
      expect(other.getCardCost(sponsors)).eq(3);
      play(tracer, other, CardName.SPONSORS);
      expect(40 - other.megaCredits).eq(finding.alternative.megacredits);
      // And the played order gives none.
      expect(ofKind(findings(tracer, other), 'play-order-discount')).is.empty;
    });

    it('never takes a card that could not be played then for the better first move', () => {
      const {player} = newSolo(undefined, 'solo-ev-notoffered');
      setHand(player, [CardName.SPONSORS], 40);
      const before = projectCoachState(player);
      // Earth Office was not in hand when Sponsors was played (it came later).
      const later = {...before, choices: before.choices};
      const result = evaluate([
        event(1, 'play-card', [CardName.SPONSORS], before, {cost: 6}),
        event(2, 'play-card', [CardName.EARTH_OFFICE], later, {cost: 1}),
      ]);
      expect(result.findings.filter((f) => f.kind === 'play-order-discount')).is.empty;
      expect(result.checked.find((c) => c.kind === 'play-order-discount')?.skipped).deep.include({reason: 'later-card-not-playable-then', count: 1});
    });

    it('keeps a finding only conditional when other actions happened between the two plays', () => {
      const {player} = newSolo(undefined, 'solo-ev-between');
      setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
      play(tracer, player, CardName.SPONSORS);
      act(tracer, player, {type: 'or', index: optionIndex(player, 'Standard projects'), response: {type: 'projectCard', card: CardName.POWER_PLANT_STANDARD_PROJECT, payment: Payment.of({megacredits: 11})}});
      play(tracer, player, CardName.EARTH_OFFICE);
      const [finding] = ofKind(findings(tracer, player), 'play-order-discount');
      expect(finding).to.deep.include({confidence: 'conditional', intervention: false});
      expect(finding.limits).includes('other-actions-between-the-plays');
    });

    it('checks the payment of both cards with the engine rules (M€, steel, titanium)', () => {
      const {player} = newSolo(undefined, 'solo-ev-pay');
      setHand(player, [CardName.SPONSORS], 3);
      const poor = projectCoachState(player);
      // 3 M€: Earth Office (1) then Sponsors (3) is payable; Sponsors (6) first is not.
      expect(canPayInOrder(poor, {card: CardName.EARTH_OFFICE, cost: 1}, {card: CardName.SPONSORS, cost: 3})).is.false;
      const rich = {...poor, me: {...poor.me, resources: {...poor.me.resources, megacredits: 4}}};
      expect(canPayInOrder(rich, {card: CardName.EARTH_OFFICE, cost: 1}, {card: CardName.SPONSORS, cost: 3})).is.true;
      // Steel pays only for building cards: Mine (building) with steel, Sponsors with M€.
      const steel = {...poor, me: {...poor.me, steelValue: 2, resources: {...poor.me.resources, megacredits: 6, steel: 2}}};
      expect(canPayInOrder(steel, {card: CardName.MINE, cost: 4}, {card: CardName.SPONSORS, cost: 6})).is.true;
      expect(canPayInOrder(steel, {card: CardName.SPONSORS, cost: 6}, {card: CardName.SPONSORS, cost: 4})).is.false;
    });
  });

  describe('B. purchases that could not be played', () => {
    function researchState(temperature: number, generation = 5) {
      const {game, player} = newSolo(undefined, `solo-ev-buy-${temperature}-${generation}`);
      setTemperature(game, temperature);
      game.generation = generation;
      player.takeAction();
      return projectCoachState(player);
    }

    it('finds a card bought when its maximum requirement was already exceeded', () => {
      const state = researchState(-10);
      const result = evaluate([event(1, 'buy-cards', [CardName.ARCTIC_ALGAE], state)]);
      const [finding] = result.findings;
      expect(finding).to.deep.include({kind: 'unplayable-purchase', confidence: 'verified', intervention: true});
      expect(finding.difference).deep.eq({megacredits: 3});
      expect(finding.evidence.find((e) => e.kind === 'requirement')?.value).to.deep.include({permanentlyUnmet: true, current: -10, target: -12});
    });

    it('does not judge a card that could still be played, or that was played later', () => {
      const cold = researchState(-20);
      expect(evaluate([event(1, 'buy-cards', [CardName.ARCTIC_ALGAE], cold)]).findings).is.empty;
      const warm = researchState(-10);
      const played = evaluate([
        event(1, 'buy-cards', [CardName.ARCTIC_ALGAE], warm),
        event(2, 'play-card', [CardName.ARCTIC_ALGAE], warm, {cost: 12}),
      ]);
      expect(played.findings.filter((f) => f.kind === 'unplayable-purchase')).is.empty;
    });

    it('keeps a last-generation purchase with an unmet requirement only conditional', () => {
      const state = researchState(-30, 14);
      const [finding] = evaluate([event(1, 'buy-cards', [CardName.KELP_FARMING], state)]).findings;
      expect(finding).to.deep.include({confidence: 'conditional', intervention: false});
      expect(finding.limits).includes('later-draws-and-actions-unknown');
    });

    it('never judges undone decisions', () => {
      const state = researchState(-10);
      expect(evaluate([event(1, 'buy-cards', [CardName.ARCTIC_ALGAE], state, {series: 'superseded'})]).findings).is.empty;
    });
  });

  describe('C. production payback', () => {
    function lateGame(generation: number, card: CardName, keepCorporation = false) {
      const {game, player} = newSolo(undefined, `solo-ev-payback-${generation}-${card}-${keepCorporation}`);
      game.generation = generation;
      if (!keepCorporation) {
        withoutCorporation(player);
      }
      setHand(player, [card], 40);
      play(tracer, player, card);
      return ofKind(findings(tracer, player), 'production-payback');
    }

    it('finds a M€ production card played too late to pay back', () => {
      // Generation 13 of 14: 2 production phases left, Sponsors (6 M€) returns 2 × 2 = 4.
      const [finding] = lateGame(13, CardName.SPONSORS);
      expect(finding).to.deep.include({confidence: 'verified', intervention: true});
      expect(finding.difference).deep.eq({megacredits: 2});
      expect(finding.evidence.find((e) => e.kind === 'forecast')?.value).to.deep.include({productionPhasesLeft: 2, returned: 4, balance: -2});
    });

    it('does not judge when a card in play may react (its effect is not modeled)', () => {
      // The corporation of this test game (Interplanetary Cinematics) reacts to plays: no M€ verdict.
      expect(lateGame(13, CardName.SPONSORS, true)).is.empty;
    });

    it('does not judge early plays or plays that pay back', () => {
      expect(lateGame(5, CardName.SPONSORS)).is.empty;
      expect(lateGame(12, CardName.SPONSORS)).is.empty;
    });

    it('does not turn other productions or side effects into a M€ verdict', () => {
      const [finding] = lateGame(13, CardName.POWER_PLANT);
      expect(finding).to.deep.include({confidence: 'conditional', intervention: false});
      expect(finding.limits).includes('other-productions-not-valued-in-megacredits');
    });
  });

  it('is off outside solo games and when the history is off', () => {
    const alice = TestPlayer.BLUE.newPlayer();
    const bob = TestPlayer.RED.newPlayer();
    Game.newInstance('game-solo-ev-2p', [alice, bob], alice, 'spectator-ev-2p');
    expect(findings(tracer, alice)).to.deep.include({status: 'not-solo', findings: []});
    const {player} = newSolo(undefined, 'solo-ev-off');
    expect(findings(undefined, player)).to.deep.include({status: 'disabled', findings: []});
  });

  it('serves findings read-only through the route, with stable ids', async () => {
    const {game, player} = newSolo(undefined, 'solo-ev-route');
    setHand(player, [CardName.EARTH_OFFICE, CardName.SPONSORS], 40);
    play(tracer, player, CardName.SPONSORS);
    play(tracer, player, CardName.EARTH_OFFICE);
    setCoachTracer(tracer);
    const scaffolding = new RouteTestScaffolding();
    await scaffolding.ctx.gameLoader.add(game);
    const serialized = JSON.stringify(game.serialize());
    const get = async () => {
      const res = new MockResponse();
      scaffolding.url = `/api/coach/findings?id=${player.id}`;
      await scaffolding.get(ApiCoachFindings.INSTANCE, res);
      expect(res.statusCode).eq(statusCode.ok);
      expect(res.headers.get('Cache-Control')).eq('no-store');
      return JSON.parse(res.content) as CoachFindingsV1;
    };
    const first = await get();
    const second = await get();
    expect(first.findings.map((f) => f.id)).deep.eq(second.findings.map((f) => f.id));
    expect(first.findings.some((f) => f.kind === 'play-order-discount')).is.true;
    expect(first.checked.map((c) => c.kind)).deep.eq(['play-order-discount', 'unplayable-purchase', 'production-payback']);
    expectNoSecretIds(first, game);
    expect(JSON.stringify(game.serialize())).eq(serialized);
    expect(JSON.stringify(first)).does.not.match(/optimal|best move|mistake|最適|悪手/i);
  });

  it('uses the snapshot before the decision, not later knowledge', () => {
    const {player} = newSolo(undefined, 'solo-ev-time');
    player.cardsInHand.push(newCard(CardName.SPONSORS) as IProjectCard);
    setHand(player, [CardName.SPONSORS], 40);
    play(tracer, player, CardName.SPONSORS);
    // Earth Office arrives only now (as if drawn later): the earlier play is not judged by it.
    const result = evaluate([
      event(1, 'play-card', [CardName.SPONSORS], projectCoachState(player), {cost: 6}),
    ]);
    expect(result.findings).is.empty;
  });
});
