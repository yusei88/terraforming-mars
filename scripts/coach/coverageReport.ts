// Coverage of the coach analysis for base game and Corporate Era cards (Phase 2, Gate A).
//
//   npx tsx scripts/coach/coverageReport.ts > docs/coach/phase2-coverage.md
//
// Generated from the same code the analysis runs (extractFeatures.ts), so it cannot drift from it.
import {getCatalog} from '../../src/extensions/coach/server/cardCatalog';
import {extractMechanics} from '../../src/extensions/coach/server/analysis/extractFeatures';
import {CardType} from '../../src/common/cards/CardType';
import {EffectAtom, MechanicsSupport, RequirementSpec} from '../../src/extensions/coach/common/CoachMechanics';

function atomText(atom: EffectAtom): string {
  switch (atom.kind) {
  case 'stock':
  case 'production':
  case 'spend':
    return `${atom.source}:${atom.kind} ${atom.resource} ${atom.amount > 0 && atom.kind !== 'spend' ? '+' : ''}${atom.amount}`;
  case 'tr':
    return `${atom.source}:TR +${atom.amount}`;
  case 'global':
    return `${atom.source}:${atom.parameter} +${atom.steps} step`;
  case 'drawCard':
    return `${atom.source}:draw ${atom.count}`;
  case 'addResourcesHere':
    return `${atom.source}:+${atom.count} resource here`;
  case 'cardDiscount':
    return `discount ${atom.amount} ${atom.tag ?? 'all'}${atom.per === 'card' ? ' (per card)' : ''}`;
  case 'requirementBonus':
    return `requirement bonus ${atom.steps}${atom.nextCardOnly ? ' (next card)' : ''}`;
  case 'alloyValue':
    return `${atom.resource} value +${atom.amount}`;
  case 'startingMegaCredits':
    return `starting M€ ${atom.amount}`;
  case 'researchCardCost':
    return `research card cost ${atom.amount}`;
  case 'victoryPoints':
    return `VP ${atom.amount}`;
  case 'victoryPointsPerResource':
    return `VP ${atom.points}/${atom.per} resources`;
  case 'victoryPointsPerTag':
    return `VP ${atom.points}/${atom.per} ${atom.tag} tags${atom.all ? ' (all players)' : ''}`;
  }
}

function requirementText(spec: RequirementSpec): string {
  switch (spec.kind) {
  case 'tag':
    return `${spec.max ? 'max ' : ''}${spec.count} ${spec.tag}${spec.all ? ' (all players)' : ''}`;
  case 'global':
    return `${spec.max ? 'max ' : ''}${spec.parameter} ${spec.count}`;
  case 'production':
    return `${spec.resource} production ${spec.count}`;
  case 'tr':
    return `${spec.max ? 'max ' : ''}TR ${spec.count}`;
  case 'tiles':
    return `${spec.max ? 'max ' : ''}${spec.count} ${spec.tile}${spec.all ? ' (all players)' : ''}`;
  case 'unsupported':
    return `**not evaluated**: ${spec.text}`;
  }
}

function escape(text: string): string {
  return text.replace(/\|/g, '\\|');
}

const cards = getCatalog().cards
  .filter((c) => (c.module === 'base' || c.module === 'corpera') && c.type !== CardType.PROXY &&
    c.type !== CardType.STANDARD_PROJECT && c.type !== CardType.STANDARD_ACTION)
  .sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
const rows = cards.map((card) => ({card, mechanics: extractMechanics(card)}));

const lines: Array<string> = [];
lines.push('# Phase 2 カバレッジ監査 — 基本セット・企業時代');
lines.push('');
lines.push('`scripts/coach/coverageReport.ts` が生成（手で編集しない）。分類の意味:');
lines.push('');
lines.push('- **supported**: カードの全効果が固定値の効果原子（EffectAtom）になっている。プレイ時効果は実エンジンとの差分テストで全件一致（`golden.spec.ts`）。');
lines.push('- **partial**: 一部が効果原子、残りは未解析（理由付き）。このカードを含む合計値は厳密ではない。');
lines.push('- **unsupported**: 効果原子がなく、すべて未解析。');
lines.push('- **none**: 効果がない。');
lines.push('');
lines.push(`カタログ版: \`${getCatalog().catalogVersion}\``);
lines.push('');

const counts = (module: string) => {
  const result: Record<MechanicsSupport, number> = {supported: 0, partial: 0, unsupported: 0, none: 0};
  rows.filter((r) => r.card.module === module).forEach((r) => result[r.mechanics.support]++);
  return result;
};
lines.push('## 集計');
lines.push('');
lines.push('| モジュール | 枚数 | supported | partial | unsupported | none | 要件を評価できないカード |');
lines.push('|---|---|---|---|---|---|---|');
for (const module of ['base', 'corpera']) {
  const c = counts(module);
  const total = rows.filter((r) => r.card.module === module).length;
  const unevaluated = rows.filter((r) => r.card.module === module && r.mechanics.requirements.some((s) => s.kind === 'unsupported')).length;
  lines.push(`| ${module} | ${total} | ${c.supported} | ${c.partial} | ${c.unsupported} | ${c.none} | ${unevaluated} |`);
}
lines.push('');

const reasons = new Map<string, number>();
for (const {mechanics} of rows) {
  for (const u of mechanics.unmodeled) {
    reasons.set(u.kind, (reasons.get(u.kind) ?? 0) + 1);
  }
}
lines.push('## 未解析の種類（効果の件数）');
lines.push('');
lines.push('| 種類 | 件数 |');
lines.push('|---|---|');
for (const [kind, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${kind} | ${n} |`);
}
lines.push('');

lines.push('## カード別');
lines.push('');
lines.push('| カード | モジュール | 種別 | 分類 | 効果原子 | 未解析（理由） | 要件 |');
lines.push('|---|---|---|---|---|---|---|');
for (const {card, mechanics} of rows) {
  const atoms = mechanics.atoms.map(atomText).join('<br>') || '—';
  const unmodeled = mechanics.unmodeled.map((u) => `${u.source}:${u.key} — ${u.reason}`).join('<br>') || '—';
  const requirements = mechanics.requirements.map(requirementText).join('<br>') || '—';
  lines.push(`| ${escape(card.name)} | ${card.module} | ${card.type} | **${mechanics.support}** | ${escape(atoms)} | ${escape(unmodeled)} | ${escape(requirements)} |`);
}
console.log(lines.join('\n'));
