import {CoachLabel} from '../../common/CoachChoiceList';
import {FindingKind} from '../../common/CoachFindings';
import {ReflectionGate} from '../../common/CoachReflection';

// CoachQuestioner (P3-SOLO-3): the questions of a reflection, as fixed templates.
//
// It is kept apart from the evaluation (the Strategist: server/solo/evaluator.ts). It receives only what
// the player did (the kind of decision, the cards, the generation), never the alternative, the
// difference or the verdict, so its questions cannot give the answer away. Facts are passed in only for
// Gate C, where the player is asked to look again at the evidence.

/** What the questioner may know about the decision. Deliberately without the conclusion. */
export type QuestionContext = {
  kind: FindingKind,
  generation: number,
  /** play-order-discount: [first played, played later]; others: [the card]. */
  cards: ReadonlyArray<string>,
};

export type Question = {gate: ReflectionGate, question?: CoachLabel, options: Array<{key: string, label: CoachLabel}>};

const card = (name: string | undefined) => ({text: name ?? '', card: true});
const label = (template: string, ...params: Array<{text: string, card?: boolean}>): CoachLabel => ({template, params});

/** Option keys that are valid at each gate (answers are checked against them). */
export function optionsAt(context: QuestionContext, answers: ReadonlyArray<string>): Array<string> {
  return nextQuestion(context, answers).options.map((o) => o.key);
}

/** The decision, in the past tense. */
export function aboutLabel(context: QuestionContext): CoachLabel {
  const [first, second] = context.cards;
  const generation = {text: String(context.generation)};
  switch (context.kind) {
  case 'play-order-discount':
    return label('Generation ${0}: you played ${1}, then ${2}', generation, card(first), card(second));
  case 'unplayable-purchase':
    return label('Generation ${0}: you bought ${1}', generation, card(first));
  case 'production-payback':
    return label('Generation ${0}: you played ${1}', generation, card(first));
  }
}

const SAME_AGAIN = [
  {key: 'c.same', label: label('I would do the same again')},
  {key: 'c.different', label: label('I would do it differently')},
  {key: 'c.depends', label: label('It depends on the game')},
];

/** Gate A: why the player did it. */
function gateA(context: QuestionContext): Question {
  const [first, second] = context.cards;
  switch (context.kind) {
  case 'play-order-discount':
    return {gate: 'A', question: label('What made you play ${0} before ${1}?', card(first), card(second)), options: [
      {key: 'a.needed-first', label: label('I needed the effect of ${0} first', card(first))},
      {key: 'a.no-order', label: label('I did not think about the order')},
      {key: 'a.decided-later', label: label('I decided to play ${0} only later', card(second))},
      {key: 'a.other', label: label('Another reason')},
    ]};
  case 'unplayable-purchase':
    return {gate: 'A', question: label('What did you plan to do with ${0} when you bought it?', card(first)), options: [
      {key: 'a.play-soon', label: label('Play it soon')},
      {key: 'a.keep', label: label('Keep it for later')},
      {key: 'a.unsure', label: label('I was not sure')},
      {key: 'a.other', label: label('Another reason')},
    ]};
  case 'production-payback':
    return {gate: 'A', question: label('Why did you play ${0} at that moment?', card(first)), options: [
      {key: 'a.income', label: label('For the income until the end of the game')},
      {key: 'a.other-effect', label: label('For its tag or another effect')},
      {key: 'a.spend', label: label('To use money I had')},
      {key: 'a.other', label: label('Another reason')},
    ]};
  }
}

/** Gate B: a point of view the player may have missed (depends on the answer to Gate A). */
function gateB(context: QuestionContext, a: string | undefined): Question {
  const [first, second] = context.cards;
  switch (context.kind) {
  case 'play-order-discount':
    if (a === 'a.no-order') {
      return {gate: 'B', question: label('When you play several cards in one generation, what can their order change?'), options: [
        {key: 'b.cost', label: label('What the cards cost')},
        {key: 'b.requirements', label: label('Which requirements are met')},
        {key: 'b.nothing', label: label('Nothing important')},
        {key: 'b.unsure', label: label('I am not sure')},
      ]};
    }
    if (a === 'a.decided-later') {
      return {gate: 'B', question: label('When you played ${0}, could you already have played ${1}?', card(first), card(second)), options: [
        {key: 'b.yes', label: label('Yes')}, {key: 'b.no', label: label('No')}, {key: 'b.unsure', label: label('I am not sure')},
      ]};
    }
    return {gate: 'B', question: label('Does ${0} change what other cards in your hand cost?', card(second)), options: [
      {key: 'b.yes', label: label('Yes')}, {key: 'b.no', label: label('No')}, {key: 'b.unsure', label: label('I am not sure')},
    ]};
  case 'unplayable-purchase':
    if (a === 'a.play-soon') {
      return {gate: 'B', question: label('What does ${0} need before it can be played?', card(first)), options: [
        {key: 'b.global', label: label('A global parameter in a range')},
        {key: 'b.tags', label: label('Tags')},
        {key: 'b.production', label: label('Production')},
        {key: 'b.unsure', label: label('I am not sure')},
      ]};
    }
    return {gate: 'B', question: label('Could the requirement of ${0} still be met later in the game?', card(first)), options: [
      {key: 'b.yes', label: label('Yes')}, {key: 'b.no', label: label('No')}, {key: 'b.unsure', label: label('I am not sure')},
    ]};
  case 'production-payback':
    return {gate: 'B', question: label('How many production phases were left in the game when you played ${0}?', card(first)), options: [
      ...['0', '1', '2', '3'].map((n) => ({key: `b.${n}`, label: label('${0}', {text: n})})),
      {key: 'b.unsure', label: label('I am not sure')},
    ]};
  }
}

/** The next question for the answers given so far (A → B → C → done). */
export function nextQuestion(context: QuestionContext, answers: ReadonlyArray<string>): Question {
  switch (answers.length) {
  case 0:
    return gateA(context);
  case 1:
    return gateB(context, answers[0]);
  case 2:
    return {gate: 'C', question: label('With these facts, would you make the same choice again?'), options: SAME_AGAIN};
  default:
    return {gate: 'done', question: label('Thank you. You can open the comparison with the alternative if you want.'), options: []};
  }
}

/** A point of view to consider, without the conclusion. */
export function hintLines(context: QuestionContext): Array<CoachLabel> {
  switch (context.kind) {
  case 'play-order-discount':
    return [label('Look at what each card does to the cost of the other cards you play in the same generation.')];
  case 'unplayable-purchase':
    return [label('Look at the requirements of the card and at how far the game had progressed when you bought it.')];
  case 'production-payback':
    return [label('Compare what the card costs with the income it can still bring before the game ends.')];
  }
}

/** Rules that apply (certain, general facts of the game). */
export function ruleLines(context: QuestionContext, lastGeneration: number): Array<CoachLabel> {
  switch (context.kind) {
  case 'play-order-discount':
    return [label('A discount only applies to cards played after the card that gives it.'), label('The cost of a card is computed when it is played.')];
  case 'unplayable-purchase':
    return [label('Global parameters (temperature, oxygen, oceans) never go down.'), label('Once a maximum requirement is exceeded, the card can no longer be played.')];
  case 'production-payback':
    return [label('Production pays out once in each production phase.'), label('This solo game ends in generation ${0}.', {text: String(lastGeneration)})];
  }
}
