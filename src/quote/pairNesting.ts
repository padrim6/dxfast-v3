// DXFAST :: Aninhamento com encaixe aos pares (interlocking conservador)
// Para pecas com silhueta concava (gusset, lifting lug, etc), parear a peca com
// uma copia girada que se encaixa produz um ladrilho mais compacto que a bounding
// box. Ladrilhamos esse par em grade. E um encaixe REAL, deterministico e seguro:
//  - as duas pecas do par sao verificadas por raster com folga >= gap (nunca
//    sobrepoem);
//  - o ladrilho e grade-packed com gap entre ladrilhos;
//  - o layout final e validado celula a celula; se algo falhar, quem chama cai no
//    retangular (nunca superestima).
// Proibido o caractere traco-longo.

import { Point2D } from '../types/cad';
import type { Placement } from './nesting';
import {
  Mask,
  chooseCell,
  rasterizeLoops,
  rotateMask,
  topProfile,
  bottomProfile,
} from './partRaster';

type Deg = 0 | 90 | 180 | 270;

interface PairPart {
  dx: number; // mm, origem do footprint no sistema do ladrilho
  dy: number;
  rot: Deg;
  w: number; // footprint
  h: number;
}
interface PairTile {
  w: number; // mm
  h: number;
  parts: PairPart[]; // sempre 2
  area: number; // mm^2 (bbox do ladrilho)
}

function footprint(W: number, H: number, rot: Deg): [number, number] {
  return rot === 90 || rot === 270 ? [H, W] : [W, H];
}

// Dilata a mascara por um DISCO de raio k celulas (distancia euclidiana). Garante
// folga euclidiana >= k celulas. Diferente do quadrado (Chebyshev), nao vaza a
// parte alta da peca para colunas vizinhas, entao nao rejeita encaixes na diagonal.
function dilate(mask: Mask, k: number): Mask {
  if (k <= 0) return mask;
  const { cols, rows, cell, data } = mask;
  const out = new Uint8Array(cols * rows);
  // offsets do disco (di^2 + dj^2 <= k^2)
  const offs: Array<[number, number]> = [];
  for (let di = -k; di <= k; di++)
    for (let dj = -k; dj <= k; dj++)
      if (di * di + dj * dj <= k * k) offs.push([di, dj]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!data[r * cols + c]) continue;
      for (const [dr, dc] of offs) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        out[rr * cols + cc] = 1;
      }
    }
  }
  return { cols, rows, cell, data: out };
}

// B (deslocado por s colunas, dy linhas) colide com dilatedA?
function collides(dilatedA: Mask, B: Mask, s: number, dy: number): boolean {
  for (let r = 0; r < B.rows; r++) {
    const ar = r + dy;
    if (ar < 0 || ar >= dilatedA.rows) continue;
    for (let c = 0; c < B.cols; c++) {
      if (!B.data[r * B.cols + c]) continue;
      const ac = c + s;
      if (ac < 0 || ac >= dilatedA.cols) continue;
      if (dilatedA.data[ar * dilatedA.cols + ac]) return true;
    }
  }
  return false;
}

/**
 * Melhor ladrilho de par para a silhueta dada. Retorna null se o pareamento nao
 * for sensivelmente melhor que a bounding box (nesse caso o retangular ja basta).
 */
export function buildPairTile(
  outer: Point2D[][],
  W: number,
  H: number,
  gap: number
): PairTile | null {
  const cell = chooseCell(W, H);
  const base = rasterizeLoops(outer, W, H, cell);
  const masks: Record<Deg, Mask> = {
    0: base,
    90: rotateMask(base, 90),
    180: rotateMask(base, 180),
    270: rotateMask(base, 270),
  };
  const gapCells = Math.max(1, Math.round(gap / cell));
  const singleArea = W * H;

  // candidatos (ordenados depois por area) antes da verificacao cara
  interface Cand {
    rotA: Deg; rotB: Deg; s: number; dy: number; area: number;
  }
  const cands: Cand[] = [];

  const rotAs: Deg[] = [0, 90];
  const rotBs: Deg[] = [0, 90, 180, 270];
  for (const rotA of rotAs) {
    const A = masks[rotA];
    const topA = topProfile(A);
    for (const rotB of rotBs) {
      const B = masks[rotB];
      const botB = bottomProfile(B);
      // desloca B horizontalmente por s colunas (coluna c de B sobre coluna c+s de A)
      for (let s = -(B.cols - 1); s <= A.cols - 1; s++) {
        // dy minimo: B acima de A em toda coluna com sobreposicao horizontal
        let dy = -Infinity;
        let anyOverlap = false;
        for (let c = 0; c < B.cols; c++) {
          const ac = c + s;
          if (ac < 0 || ac >= A.cols) continue;
          if (botB[c] >= B.rows) continue; // coluna de B vazia
          if (topA[ac] < 0) continue; // coluna de A vazia
          anyOverlap = true;
          const req = topA[ac] + gapCells + 1 - botB[c];
          if (req > dy) dy = req;
        }
        if (!anyOverlap || dy === -Infinity) continue;
        // bbox da uniao (em celulas) -> area em mm^2
        const minC = Math.min(0, s);
        const maxC = Math.max(A.cols, s + B.cols);
        const minR = Math.min(0, dy);
        const maxR = Math.max(A.rows, dy + B.rows);
        const area = (maxC - minC) * (maxR - minR) * cell * cell;
        // Tiles com area >= 2x a bbox unitaria nunca rendem mais que as pecas
        // isoladas; abaixo disso, a comparacao final de contagem decide.
        if (area < singleArea * 2.0) {
          cands.push({ rotA, rotB, s, dy, area });
        }
      }
    }
  }

  if (cands.length === 0) return null;
  cands.sort((a, b) => a.area - b.area);

  // verifica os melhores candidatos por raster (folga real >= gap) e aceita o 1o valido
  const dilatedCache: Partial<Record<Deg, Mask>> = {};
  const limit = Math.min(cands.length, 16);
  for (let i = 0; i < limit; i++) {
    const cand = cands[i];
    const A = masks[cand.rotA];
    const B = masks[cand.rotB];
    if (!dilatedCache[cand.rotA]) dilatedCache[cand.rotA] = dilate(A, gapCells);
    const dA = dilatedCache[cand.rotA]!;
    // bump de dy se o perfil subestimou (colunas laterais / concavidades)
    let dy = cand.dy;
    let ok = false;
    for (let bump = 0; bump <= 4; bump++) {
      if (!collides(dA, B, cand.s, dy)) { ok = true; break; }
      dy++;
    }
    if (!ok) continue;

    // monta o ladrilho com coordenadas em mm (origem normalizada para >= 0)
    const [awF, ahF] = footprint(W, H, cand.rotA);
    const [bwF, bhF] = footprint(W, H, cand.rotB);
    const aX = 0, aY = 0;
    const bX = cand.s * cell, bY = dy * cell;
    const minX = Math.min(aX, bX);
    const minY = Math.min(aY, bY);
    const aPart: PairPart = { dx: aX - minX, dy: aY - minY, rot: cand.rotA, w: awF, h: ahF };
    const bPart: PairPart = { dx: bX - minX, dy: bY - minY, rot: cand.rotB, w: bwF, h: bhF };
    const tileW = Math.max(aPart.dx + awF, bPart.dx + bwF);
    const tileH = Math.max(aPart.dy + ahF, bPart.dy + bhF);
    return { w: tileW, h: tileH, parts: [aPart, bPart], area: tileW * tileH };
  }
  return null;
}

// Gira o ladrilho 90 graus CCW (recalcula origem/rotacao de cada peca).
function rotateTile90(tile: PairTile): PairTile {
  const newW = tile.h;
  const newH = tile.w;
  const parts = tile.parts.map((p): PairPart => {
    // footprint [dx,dx+pw]x[dy,dy+ph] sob 90 CCW no box de altura tile.h:
    //   (X,Y) -> (tile.h - Y, X). nova origem = (tile.h - (dy+ph), dx), footprint trocado.
    const nrot = (((p.rot + 90) % 360) as Deg);
    return {
      dx: tile.h - (p.dy + p.h),
      dy: p.dx,
      rot: nrot,
      w: p.h,
      h: p.w,
    };
  });
  return { w: newW, h: newH, parts, area: newW * newH };
}

/**
 * Aninhamento por pares: ladrilha o melhor par em grade (nas duas orientacoes do
 * ladrilho) e expande em posicoes reais. Retorna null se nao houver par util.
 * O resultado AINDA deve ser validado por quem chama (validateLayout).
 */
export function nestByPairs(
  sheetWmm: number,
  sheetLmm: number,
  outer: Point2D[][],
  W: number,
  H: number,
  gapMm: number
): { count: number; placements: Placement[] } | null {
  const gap = gapMm > 0 ? gapMm : 0;
  const tile0 = buildPairTile(outer, W, H, gap);
  if (!tile0) return null;

  const usableW = sheetWmm - 2 * gap;
  const usableL = sheetLmm - 2 * gap;
  if (usableW <= 0 || usableL <= 0) return null;

  const variants = [tile0, rotateTile90(tile0)];
  let best: { count: number; placements: Placement[] } | null = null;

  for (const tile of variants) {
    const cols = Math.floor((usableW + gap) / (tile.w + gap));
    const rows = Math.floor((usableL + gap) / (tile.h + gap));
    if (cols < 1 || rows < 1) continue;
    const count = cols * rows * tile.parts.length;
    if (best && count <= best.count) continue;

    const placements: Placement[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tileX = gap + c * (tile.w + gap);
        const tileY = gap + r * (tile.h + gap);
        for (const part of tile.parts) {
          placements.push({
            x: tileX + part.dx,
            y: tileY + part.dy,
            w: part.w,
            h: part.h,
            rot: part.rot,
          });
        }
      }
    }
    best = { count: placements.length, placements };
  }

  return best;
}

// Colisao exata entre duas mascaras: mj deslocada por (dc,dr) celulas em relacao a mi.
function maskCollide(mi: Mask, mj: Mask, dc: number, dr: number): boolean {
  for (let r = 0; r < mj.rows; r++) {
    const ri = r + dr;
    if (ri < 0 || ri >= mi.rows) continue;
    for (let c = 0; c < mj.cols; c++) {
      if (!mj.data[r * mj.cols + c]) continue;
      const ci = c + dc;
      if (ci < 0 || ci >= mi.cols) continue;
      if (mi.data[ri * mi.cols + ci]) return true;
    }
  }
  return false;
}

/**
 * Validacao RIGOROSA e independente do layout (usada na suite de testes, nao no
 * caminho quente): confere, par a par, que nenhuma peca se sobrepoe a outra, e que
 * todas cabem na area util (margem = gap). Usa a silhueta real de cada peca em
 * resolucao fina. Pre-filtra por bounding box para ficar rapido. Retorna true se o
 * layout e fisicamente valido (sem sobreposicoes).
 */
export function validateLayoutStrict(
  sheetWmm: number,
  sheetLmm: number,
  outer: Point2D[][],
  W: number,
  H: number,
  gapMm: number,
  placements: Placement[]
): boolean {
  const gap = gapMm > 0 ? gapMm : 0;
  const cell = chooseCell(W, H);
  const base = rasterizeLoops(outer, W, H, cell);
  const masks: Record<Deg, Mask> = {
    0: base,
    90: rotateMask(base, 90),
    180: rotateMask(base, 180),
    270: rotateMask(base, 270),
  };
  const tol = cell + 1e-6;
  // dentro da area util
  for (const p of placements) {
    if (
      p.x < gap - tol ||
      p.y < gap - tol ||
      p.x + p.w > sheetWmm - gap + tol ||
      p.y + p.h > sheetLmm - gap + tol
    ) {
      return false;
    }
  }
  // sobreposicao par a par (pre-filtro por bbox)
  const n = placements.length;
  for (let i = 0; i < n; i++) {
    const a = placements[i];
    for (let j = i + 1; j < n; j++) {
      const b = placements[j];
      // bboxes se tocam?
      if (a.x + a.w <= b.x + tol || b.x + b.w <= a.x + tol) continue;
      if (a.y + a.h <= b.y + tol || b.y + b.h <= a.y + tol) continue;
      const mi = masks[a.rot];
      const mj = masks[b.rot];
      const dc = Math.round((b.x - a.x) / cell);
      const dr = Math.round((b.y - a.y) / cell);
      if (maskCollide(mi, mj, dc, dr)) return false;
    }
  }
  return true;
}
