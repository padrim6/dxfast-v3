// Checagem numerica do preview geometrico do nesting (temporario).
// Replica o transform do componente e valida que a peca desenhada cai dentro da
// chapa e dentro da celula de cada posicao do aninhamento.

import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { tessellatePart } from '../src/components/quote/partOutline';
import { nestShape } from '../src/quote/nesting';

const SHEET_W = 1200;
const SHEET_L = 3000;
const GAP = 5;
let failures = 0;

function check(templateId: string) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    console.log('  (template nao encontrado: ' + templateId + ')');
    return;
  }
  const params: Record<string, number> = { ...template.defaultParams };
  const geom = generateGeometry(template, params, template.defaultFeatures);
  const loops = tessellatePart(geom);
  const W0 = loops.w;
  const H0 = loops.h;
  const res = nestShape(SHEET_W, SHEET_L, geom.metrics.blankWidthMm, geom.metrics.blankHeightMm, GAP, loops.outer);

  const landscape = SHEET_W >= SHEET_L;
  const boardW = landscape ? SHEET_W : SHEET_L;
  const boardH = landscape ? SHEET_L : SHEET_W;
  const sheetToSvg = (sx: number, sy: number): [number, number] => {
    let dx: number, dy: number;
    if (landscape) {
      dx = sx; dy = sy;
    } else {
      dx = SHEET_L - sy; dy = sx;
    }
    return [dx, boardH - dy];
  };

  let outOfBoard = 0;
  let outOfCell = 0;
  let holeOutOfBbox = 0;
  let totalPts = 0;

  for (const p of res.placements) {
    const place = (u: number, v: number): [number, number] => {
      if (p.rot === 90) return [p.x + (H0 - v), p.y + u];
      if (p.rot === 180) return [p.x + (W0 - u), p.y + (H0 - v)];
      if (p.rot === 270) return [p.x + v, p.y + (W0 - u)];
      return [p.x + u, p.y + v];
    };
    const swapped = p.rot === 90 || p.rot === 270;
    const pw = swapped ? H0 : W0;
    const ph = swapped ? W0 : H0;

    const allLoops = [...loops.outer, ...loops.holes];
    for (let li = 0; li < allLoops.length; li++) {
      const loop = allLoops[li];
      const isHole = li >= loops.outer.length;
      for (const pt of loop) {
        totalPts++;
        // dentro da bbox local?
        if (pt.x < -0.01 || pt.y < -0.01 || pt.x > W0 + 0.01 || pt.y > H0 + 0.01) {
          if (isHole) holeOutOfBbox++;
        }
        const [sx, sy] = place(pt.x, pt.y);
        // dentro da celula da peca (coords de chapa)?
        if (sx < p.x - 0.01 || sy < p.y - 0.01 || sx > p.x + pw + 0.01 || sy > p.y + ph + 0.01) {
          outOfCell++;
        }
        const [X, Y] = sheetToSvg(sx, sy);
        if (X < -0.01 || Y < -0.01 || X > boardW + 0.01 || Y > boardH + 0.01) {
          outOfBoard++;
        }
      }
    }
  }

  const ok = outOfBoard === 0 && outOfCell === 0 && holeOutOfBbox === 0;
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'OK ' : 'XX '}${templateId.padEnd(16)} bbox ${W0.toFixed(0)}x${H0.toFixed(0)} | pecas=${res.placements.length} outer=${loops.outer.length} furos=${loops.holes.length} pts=${totalPts} | foraChapa=${outOfBoard} foraCelula=${outOfCell} furoForaBbox=${holeOutOfBbox}`
  );
}

console.log('Checagem do preview geometrico (chapa ' + SHEET_W + 'x' + SHEET_L + ', gap ' + GAP + '):');
for (const id of ['rect_plate', 'circle_flange', 'gusset_bracket', 'lifting_lug', 'profile_u', 'rufo_flashing']) {
  check(id);
}
console.log(failures === 0 ? '\nTUDO OK (0 falhas).' : `\n${failures} FALHA(S).`);
process.exit(failures === 0 ? 0 : 1);
