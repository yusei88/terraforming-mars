import {CoachStateV1} from '../../common/CoachState';
import {RequirementGap, Evidence} from '../../common/CoachAnalysis';
import {CardMechanics, RequirementSpec} from '../../common/CoachMechanics';
import {CardName} from '@/common/cards/CardName';
import {Tag} from '@/common/cards/Tag';
import {mechanicsOf} from './mechanicsCatalog';

// Distance between the current game and a card's requirements, with the engine's rules
// (src/server/cards/requirements): a minimum tag requirement counts wild tags, a maximum does not;
// global parameter requirements shift by the player's requirement bonus (2 °C per step for temperature);
// a maximum on a global parameter, once exceeded, can never be met again. Reads only the snapshot.

// Cards that change how tags are counted for requirements (Tags.count 'default' mode).
const TAG_SUBSTITUTIONS: ReadonlyArray<{card: CardName, tag?: Tag, note: string}> = [
  {card: CardName.EARTH_EMBASSY, tag: Tag.EARTH, note: 'Earth Embassy counts Moon tags as Earth tags'},
  {card: CardName.HABITAT_MARTE, tag: Tag.SCIENCE, note: 'Habitat Marte counts Mars tags as science tags'},
  {card: CardName.ODYSSEY, note: 'Odyssey counts tags on events'},
  {card: CardName.CHIMERA, note: 'Chimera changes wild tag counting'},
];

const SCALE: Readonly<Record<'temperature' | 'oxygen' | 'oceans', number>> = {temperature: 2, oxygen: 1, oceans: 1};

const CITY_TILES: ReadonlySet<string> = new Set(['CITY', 'CAPITAL', 'OCEAN_CITY', 'RED_CITY', 'NEW_HOLLAND']);
const GREENERY_TILES: ReadonlySet<string> = new Set(['GREENERY', 'WETLANDS']);

function evidence(state: CoachStateV1, fieldPath: string, cardName?: CardName): Evidence {
  const item: Evidence = {kind: 'state', fieldPath, stateFingerprint: state.fingerprint};
  if (cardName !== undefined) {
    item.cardName = cardName;
  }
  return item;
}

function catalogEvidence(card: CardName, index: number): Evidence {
  return {kind: 'catalog', fieldPath: `requirements[${index}]`, cardName: card};
}

/* Assumptions that apply when expansions outside the analysis scope are in play. */
function expansionAssumptions(state: CoachStateV1): Array<string> {
  return state.game.unsupported.length > 0 ?
    [`expansions not covered by the analysis are in play (${state.game.unsupported.map((u) => u.part).join(', ')}); they may change requirement rules`] :
    [];
}

function inequality(observed: number, target: number, max: boolean, scale: number): {gap: number, met: boolean} {
  if (max) {
    const over = Math.max(0, Math.ceil((observed - target) / scale));
    return {gap: over, met: observed <= target};
  }
  const missing = Math.max(0, Math.ceil((target - observed) / scale));
  return {gap: missing, met: observed >= target};
}

function tagGap(state: CoachStateV1, spec: Extract<RequirementSpec, {kind: 'tag'}>, card: CardName, index: number): RequirementGap {
  const tags = state.me.tags;
  let observed = tags[spec.tag] ?? 0;
  const used = [evidence(state, `me.tags.${spec.tag}`)];
  if (!spec.max && spec.tag !== Tag.WILD) {
    observed += tags[Tag.WILD] ?? 0;
    used.push(evidence(state, 'me.tags.wild'));
  }
  if (spec.all) {
    state.opponents.forEach((opponent, i) => {
      observed += opponent.tags[spec.tag] ?? 0;
      used.push(evidence(state, `opponents[${i}].tags.${spec.tag}`));
    });
  }
  const tableau = new Set(state.me.tableau.map((c) => c.name));
  const assumptions = [
    ...TAG_SUBSTITUTIONS.filter((s) => tableau.has(s.card) && (s.tag === undefined || s.tag === spec.tag)).map((s) => s.note),
    ...expansionAssumptions(state),
  ];
  const {gap, met} = inequality(observed, spec.count, spec.max, 1);
  return finish({kind: 'tag', observed, target: spec.count, comparator: spec.max ? '<=' : '>=', gap, met, max: spec.max, assumptions, evidence: [...used, catalogEvidence(card, index)], permanent: false});
}

/* Requirement bonus of the player for global parameters: cards in play, Special Design only right after it. */
function requirementBonus(state: CoachStateV1): {steps: number, assumptions: Array<string>, evidence: Array<Evidence>} {
  let steps = 0;
  const assumptions: Array<string> = [];
  const used: Array<Evidence> = [];
  state.me.tableau.forEach((card, i) => {
    const mechanics = mechanicsOf(card.name);
    if (mechanics === undefined) {
      return;
    }
    for (const atom of mechanics.atoms) {
      if (atom.kind === 'requirementBonus' && (!atom.nextCardOnly || state.me.lastCardPlayed === card.name)) {
        steps += atom.steps;
        used.push(evidence(state, `me.tableau[${i}]`, card.name));
      }
    }
    if (mechanics.unmodeled.some((u) => u.key === 'globalParameterRequirementBonus')) {
      assumptions.push(`${card.name} gives a requirement bonus that is not modeled`);
    }
  });
  return {steps, assumptions, evidence: used};
}

function globalGap(state: CoachStateV1, spec: Extract<RequirementSpec, {kind: 'global'}>, card: CardName, index: number): RequirementGap {
  const parameter = state.game[spec.parameter];
  const bonus = requirementBonus(state);
  const scale = SCALE[spec.parameter];
  const shift = bonus.steps * scale;
  const observed = spec.max ? parameter.value - shift : parameter.value + shift;
  const {gap, met} = inequality(observed, spec.count, spec.max, scale);
  return finish({
    kind: spec.parameter, observed, target: spec.count, comparator: spec.max ? '<=' : '>=', gap, met, max: spec.max,
    assumptions: [...bonus.assumptions, ...expansionAssumptions(state)],
    evidence: [evidence(state, `game.${spec.parameter}.value`), ...bonus.evidence, catalogEvidence(card, index)],
    permanent: spec.max && !met,
  });
}

function tileCount(state: CoachStateV1, tiles: ReadonlySet<string>, all: boolean): number {
  return state.game.spaces.filter((space) => space.tile !== undefined && tiles.has(space.tile.type) &&
    (all || space.tile.ownerColor === state.me.color)).length;
}

function finish(gap: {
  kind: RequirementGap['kind'], observed: number, target: number, comparator: '>=' | '<=', gap: number, met: boolean, max: boolean,
  assumptions: Array<string>, evidence: Array<Evidence>, permanent: boolean,
}): RequirementGap {
  const result: RequirementGap = {
    kind: gap.kind,
    observed: gap.observed,
    target: gap.target,
    comparator: gap.comparator,
    gap: gap.gap,
    status: gap.assumptions.length > 0 ? 'conditional' : gap.met ? 'met' : 'unmet',
    evidence: gap.evidence,
  };
  if (gap.assumptions.length > 0) {
    result.assumptions = gap.assumptions;
  }
  if (gap.permanent) {
    result.permanentlyUnmet = true;
  }
  return result;
}

/** Requirement gaps of a card for the player of `state`, one per requirement spec, in order. */
export function analyzeRequirements(state: CoachStateV1, mechanics: CardMechanics): Array<RequirementGap> {
  return mechanics.requirements.map((spec, index): RequirementGap => {
    switch (spec.kind) {
    case 'tag':
      return tagGap(state, spec, mechanics.name, index);
    case 'global':
      return globalGap(state, spec, mechanics.name, index);
    case 'production': {
      const observed = state.me.production[spec.resource];
      const {gap, met} = inequality(observed, spec.count, false, 1);
      return finish({kind: 'production', observed, target: spec.count, comparator: '>=', gap, met, max: false, assumptions: expansionAssumptions(state),
        evidence: [evidence(state, `me.production.${spec.resource}`), catalogEvidence(mechanics.name, index)], permanent: false});
    }
    case 'tr': {
      const observed = state.me.terraformRating;
      const {gap, met} = inequality(observed, spec.count, spec.max, 1);
      return finish({kind: 'tr', observed, target: spec.count, comparator: spec.max ? '<=' : '>=', gap, met, max: spec.max, assumptions: [],
        evidence: [evidence(state, 'me.terraformRating'), catalogEvidence(mechanics.name, index)], permanent: false});
    }
    case 'tiles': {
      const observed = tileCount(state, spec.tile === 'cities' ? CITY_TILES : GREENERY_TILES, spec.all);
      const {gap, met} = inequality(observed, spec.count, spec.max, 1);
      return finish({kind: spec.tile, observed, target: spec.count, comparator: spec.max ? '<=' : '>=', gap, met, max: spec.max, assumptions: expansionAssumptions(state),
        evidence: [evidence(state, 'game.spaces'), catalogEvidence(mechanics.name, index)], permanent: false});
    }
    case 'unsupported':
      return {
        kind: 'other', observed: 'unknown', target: 'unknown', comparator: 'rule-dependent', gap: 'unknown', status: 'unsupported',
        assumptions: [spec.text], evidence: [catalogEvidence(mechanics.name, index)],
      };
    }
  });
}

/** True when every requirement is established as met; false when any is established as unmet; else unknown. */
export function requirementsMet(gaps: ReadonlyArray<RequirementGap>): boolean | 'unknown' {
  if (gaps.some((gap) => gap.status === 'unmet')) {
    return false;
  }
  return gaps.every((gap) => gap.status === 'met') ? true : 'unknown';
}
