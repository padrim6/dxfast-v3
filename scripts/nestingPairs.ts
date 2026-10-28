// DXFAST :: Auditoria do encaixe aos pares (interlocking)
// Prova, em pecas sinteticas e em TEMPLATES REAIS: (1) o layout e fisicamente
// valido (validacao independente par a par, sem sobreposicao, dentro da area util);
// (2) nunca pior que o retangular; (3) a peca concava realmente ganha; (4)
// deterministico; (5) desempenho. Rodar: npm run test:pairnest
// Proibido o caractere traco-longo.

import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { tessellatePart } from '../src/components/quote/partOutline';
import { nestRectangles, nestShape } from '../src/quote/nesting';
import { validateLayoutStrict } from '../src/quote/pairNesting';
import { Point2D } from '../src/types/cad';

let failures = 0;
const fail = (m: string) => { failures++; console.error('  [FALHA] ' + m); };

const SW = 3000;
const SL = 1500;

function synthetic(name: string, outer: Point2D[][], W: number, H: number, gap: number, expectGain: boolean) {
  const rect = nestRectangles(SW, SL, W, H, gap);
  const shape = nestShape(SW, SL, W, H, gap, outer);
  const valid = validateLayoutStrict(SW, SL, outer, W, H, gap, shape.placements);
  const gain = shape.count - rect.count;
  if (!valid) fail(`${name}: layout invalido (sobreposicao ou fora da area util)`);
  if (shape.count < rect.count) fail(`${name}: pior que o retangular (${shape.count} < ${rect.count})`);
  if (expectGain && gain <= 0) fail(`${name}: esperava ganho por encaixe, obteve ${gain}`);
  console.log(`  ${valid && shape.count >= rect.count ? 'OK ' : 'XX '}${name.padEnd(12)} retangular=${rect.count} encaixe=${shape.count} ganho=${gain} valido=${valid}`);
}

function realTemplate(id: string, gap: number) {
  const tpl = TEMPLATES.find((t) => t.id === id);
  if (!tpl) { console.log(`  (template ${id} nao encontrado)`); return; }
  const geom = generateGeometry(tpl, { ...tpl.defaultParams }, tpl.defaultFeatures);
  const outer = tessellatePart(geom).outer;
  const W = geom.metrics.blankWidthMm;
  const H = geom.metrics.blankHeightMm;
  const rect = nestRectangles(SW, SL, W, H, gap);
  const t0 = performance.now();
  const shape = nestShape(SW, SL, W, H, gap, outer);
  const dt = performance.now() - t0;
  const valid = validateLayoutStrict(SW, SL, outer, W, H, gap, shape.placements);
  const shape2 = nestShape(SW, SL, W, H, gap, outer);
  const det = shape.count === shape2.count;
  const gain = shape.count - rect.count;
  if (!valid) fail(`${id}: layout invalido`);
  if (shape.count < rect.count) fail(`${id}: pior que o retangular (${shape.count} < ${rect.count})`);
  if (!det) fail(`${id}: nao deterministico`);
  if (dt > 200) fail(`${id}: lento (${dt.toFixed(0)} ms)`);
  console.log(
    `  ${valid && det && shape.count >= rect.count ? 'OK ' : 'XX '}${id.padEnd(16)} bbox ${W.toFixed(0)}x${H.toFixed(0)} | retangular=${rect.count} encaixe=${shape.count} ganho=${gain} | valido=${valid} det=${det} ${dt.toFixed(0)}ms`
  );
}

console.log('================================================================');
console.log(' AUDITORIA DO ENCAIXE AOS PARES (interlocking)');
console.log('================================================================\n');

console.log('[1/3] Pecas sinteticas (com gabarito de ganho):');
synthetic('Triangulo', [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 0, y: 150 }]], 200, 150, 5, true);
synthetic('Trapezio', [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 140, y: 120 }, { x: 60, y: 120 }]], 200, 120, 5, true);
synthetic('L-shape', [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 60 }, { x: 70, y: 60 }, { x: 70, y: 180 }, { x: 0, y: 180 }]], 200, 180, 5, true);
synthetic('Retangulo', [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]], 200, 150, 5, false);

console.log('\n[2/3] Templates reais (gap 5 mm):');
for (const id of ['gusset_bracket', 'lifting_lug', 'rufo_flashing', 'circle_flange', 'rect_plate', 'profile_u']) {
  realTemplate(id, 5);
}

console.log('\n[3/3] Templates reais (gap 2 mm):');
for (const id of ['gusset_bracket', 'lifting_lug']) {
  realTemplate(id, 2);
}

console.log('\n================================================================');
if (failures === 0) {
  console.log(' RESULTADO: ENCAIXE VALIDADO (0 falhas).');
  process.exit(0);
} else {
  console.log(` RESULTADO: ${failures} FALHA(S).`);
  process.exit(1);
}
