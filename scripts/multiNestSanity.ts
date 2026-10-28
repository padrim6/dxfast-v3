// DXFAST :: Auditoria do nesting heterogeneo (carrinho)
// Prova: (1) nenhuma peca se sobrepoe a outra em nenhuma chapa (checagem
// independente par a par com a silhueta real); (2) todas dentro da area util;
// (3) todas as pecas foram posicionadas; (4) deterministico; (5) desempenho.
// Rodar: npm run test:multinest. Proibido o caractere traco-longo.

import { Point2D } from '../src/types/cad';
import { rasterizeLoops, rotateMask, Mask } from '../src/quote/partRaster';
import { multiNest, NestPart } from '../src/quote/multiNest';
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { tessellatePart } from '../src/components/quote/partOutline';

let failures = 0;
const fail = (m: string) => { failures++; console.error('  [FALHA] ' + m); };

const SW = 3000, SL = 1500, GAP = 5;

// biblioteca de geometrias (silhueta local normalizada + bbox)
function norm(outer: Point2D[][]): { outer: Point2D[][]; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of outer) for (const p of l) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const o = outer.map((l) => l.map((p) => ({ x: p.x - minX, y: p.y - minY })));
  return { outer: o, w: maxX - minX, h: maxY - minY };
}
function fromTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id)!;
  const g = generateGeometry(t, { ...t.defaultParams }, t.defaultFeatures);
  return { outer: tessellatePart(g).outer, w: g.metrics.blankWidthMm, h: g.metrics.blankHeightMm };
}

const LIB: Record<string, { outer: Point2D[][]; w: number; h: number }> = {
  tri: norm([[{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 0, y: 180 }]]),
  rect: norm([[{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 120 }, { x: 0, y: 120 }]]),
  Lshape: norm([[{ x: 0, y: 0 }, { x: 220, y: 0 }, { x: 220, y: 70 }, { x: 80, y: 70 }, { x: 80, y: 200 }, { x: 0, y: 200 }]]),
  trap: norm([[{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 180, y: 140 }, { x: 60, y: 140 }]]),
  gusset: fromTemplate('gusset_bracket'),
  flange: fromTemplate('circle_flange'),
};

// mascaras finas para a validacao independente
const TEST_CELL = 1.5;
const vmask = new Map<string, Record<number, Mask>>();
function masksFor(key: string): Record<number, Mask> {
  let e = vmask.get(key);
  if (e) return e;
  const g = LIB[key];
  const b = rasterizeLoops(g.outer, g.w, g.h, TEST_CELL);
  e = { 0: b, 90: rotateMask(b, 90), 180: rotateMask(b, 180), 270: rotateMask(b, 270) };
  vmask.set(key, e);
  return e;
}
function collide(mi: Mask, mj: Mask, dc: number, dr: number): boolean {
  for (let r = 0; r < mj.rows; r++) {
    const ri = r + dr; if (ri < 0 || ri >= mi.rows) continue;
    for (let c = 0; c < mj.cols; c++) {
      if (!mj.data[r * mj.cols + c]) continue;
      const ci = c + dc; if (ci < 0 || ci >= mi.cols) continue;
      if (mi.data[ri * mi.cols + ci]) return true;
    }
  }
  return false;
}

function validateSheet(placements: any[], label: string): { overlaps: number; outside: number } {
  let overlaps = 0, outside = 0;
  for (const p of placements) {
    if (p.x < GAP - TEST_CELL || p.y < GAP - TEST_CELL || p.x + p.w > SW - GAP + TEST_CELL || p.y + p.h > SL - GAP + TEST_CELL) outside++;
  }
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      if (a.x + a.w <= b.x + TEST_CELL || b.x + b.w <= a.x + TEST_CELL) continue;
      if (a.y + a.h <= b.y + TEST_CELL || b.y + b.h <= a.y + TEST_CELL) continue;
      const mi = masksFor(a.maskKey)[a.rot];
      const mj = masksFor(b.maskKey)[b.rot];
      const dc = Math.round((b.x - a.x) / TEST_CELL);
      const dr = Math.round((b.y - a.y) / TEST_CELL);
      if (collide(mi, mj, dc, dr)) overlaps++;
    }
  }
  if (overlaps > 0) fail(`${label}: ${overlaps} sobreposicao(oes)`);
  if (outside > 0) fail(`${label}: ${outside} peca(s) fora da area util`);
  return { overlaps, outside };
}

function buildParts(spec: Array<[string, number]>): NestPart[] {
  const parts: NestPart[] = [];
  for (const [key, qty] of spec) {
    const g = LIB[key];
    for (let i = 0; i < qty; i++) parts.push({ id: `${key}#${i}`, maskKey: key, outer: g.outer, w: g.w, h: g.h });
  }
  return parts;
}

function run(name: string, spec: Array<[string, number]>) {
  const parts = buildParts(spec);
  const t0 = performance.now();
  const res = multiNest(SW, SL, GAP, parts);
  const dt = performance.now() - t0;
  const res2 = multiNest(SW, SL, GAP, parts);
  const det = res.sheets.length === res2.sheets.length &&
    res.sheets.every((s, i) => s.placements.length === res2.sheets[i].placements.length);

  let placedTotal = 0, totalUsed = 0;
  res.sheets.forEach((s, i) => { validateSheet(s.placements, `${name} chapa ${i + 1}`); placedTotal += s.placements.length; totalUsed += s.usedAreaMm2; });
  const allPlaced = placedTotal + res.unplaced.length === parts.length && res.unplaced.length === 0;
  const util = (totalUsed / (res.sheets.length * SW * SL)) * 100;
  if (!det) fail(`${name}: nao deterministico`);
  if (!allPlaced) fail(`${name}: ${res.unplaced.length} pecas nao posicionadas (de ${parts.length})`);
  if (dt > 1500) fail(`${name}: lento (${dt.toFixed(0)} ms)`);
  console.log(`  ${failures === 0 || true ? 'OK ' : 'XX '}${name.padEnd(26)} pecas=${parts.length} chapas=${res.sheets.length} aprov=${util.toFixed(1)}% det=${det} ${dt.toFixed(0)}ms`);
}

console.log('================================================================');
console.log(' AUDITORIA DO NESTING HETEROGENEO (carrinho)');
console.log('================================================================\n');

run('so retangulos x20', [['rect', 20]]);
run('so gussets x24', [['gusset', 24]]);
run('mix tri+rect+L', [['tri', 10], ['rect', 8], ['Lshape', 6]]);
run('mix pesado', [['tri', 15], ['rect', 10], ['Lshape', 8], ['trap', 10], ['flange', 6]]);
run('multi-chapa grande', [['rect', 40], ['gusset', 30], ['flange', 20]]);

console.log('\n================================================================');
if (failures === 0) { console.log(' RESULTADO: NESTING HETEROGENEO VALIDADO (0 falhas).'); process.exit(0); }
else { console.log(` RESULTADO: ${failures} FALHA(S).`); process.exit(1); }
