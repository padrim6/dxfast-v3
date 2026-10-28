// DXFAST :: Nesting heterogeneo (varias pecas diferentes em varias chapas)
// Estrategia "meio termo" entre bounding box e NFP profissional: posicionamento
// raster bottom-left usando a SILHUETA REAL de cada peca. Cada peca desce e encosta
// no contorno do que ja esta na chapa (nao na caixa), girando 0/90/180/270. Quando
// nao cabe mais, abre nova chapa. Determinístico, leve e SEGURO (nunca sobrepoe,
// nunca superestima). A folga (gap) vale entre pecas e como margem de borda.
// Proibido o caractere traco-longo em qualquer string.

import { Point2D } from '../types/cad';
import {
  Mask,
  chooseCell,
  rasterizeLoops,
  rotateMask,
  bottomProfile,
  topProfile,
} from './partRaster';

type Deg = 0 | 90 | 180 | 270;

export interface NestPart {
  id: string; // identificador da instancia (ex.: "item3#2")
  maskKey: string; // mesma geometria compartilha a mascara (ex.: "item3")
  outer: Point2D[][]; // silhueta local normalizada a bbox
  w: number; // bbox mm
  h: number; // bbox mm
}

export interface MultiPlacement {
  id: string;
  maskKey: string;
  x: number; // mm, origem do footprint na chapa
  y: number;
  w: number; // footprint (ja rotacionado)
  h: number;
  rot: Deg;
}

export interface NestSheet {
  placements: MultiPlacement[];
  usedAreaMm2: number; // area liquida das pecas (silhueta) nesta chapa
}

export interface MultiNestResult {
  sheets: NestSheet[];
  unplaced: string[]; // ids de pecas que nao couberam em uma chapa vazia (grandes demais)
  cell: number;
}

// Dilatacao em disco (folga euclidiana >= k celulas), aplicada ao estampar.
function diskOffsets(k: number): Array<[number, number]> {
  const offs: Array<[number, number]> = [];
  for (let di = -k; di <= k; di++)
    for (let dj = -k; dj <= k; dj++)
      if (di * di + dj * dj <= k * k) offs.push([di, dj]);
  return offs;
}

interface RotMask {
  mask: Mask;
  bprof: Int32Array; // perfil inferior (por coluna)
  tprof: Int32Array; // perfil superior (por coluna)
  rot: Deg;
}

// area de poligonos (shoelace)
function loopsArea(outer: Point2D[][]): number {
  let t = 0;
  for (const l of outer) {
    let a = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i], q = l[(i + 1) % l.length];
      a += p.x * q.y - q.x * p.y;
    }
    t += Math.abs(a) / 2;
  }
  return t;
}

/**
 * Aninha varias pecas (ja expandidas por quantidade) em quantas chapas forem
 * necessarias. Todas as pecas devem ser da MESMA espessura/material (a chapa e
 * unica); o agrupamento por espessura e responsabilidade de quem chama.
 */
export function multiNest(
  sheetWmm: number,
  sheetLmm: number,
  gapMm: number,
  parts: NestPart[]
): MultiNestResult {
  const gap = gapMm > 0 ? gapMm : 0;
  // resolucao: fina o bastante para o erro de raster nao causar sobreposicao, mas
  // limitada para a chapa inteira caber num grid barato.
  const cell = Math.min(Math.max(2.0, Math.max(sheetWmm, sheetLmm) / 1300), 4);
  // floor: o grid fica DENTRO da chapa (nenhuma celula ultrapassa a borda).
  const cols = Math.max(1, Math.floor(sheetWmm / cell));
  const rows = Math.max(1, Math.floor(sheetLmm / cell));
  // folga minima de 2 celulas: garante separacao real mesmo com o arredondamento
  // do raster (cada forma pode exceder a sua rasterizacao em ~meia celula).
  const gapCells = Math.max(2, Math.round(gap / cell));
  const margin = gapCells; // margem de borda = gap
  const offs = diskOffsets(gapCells);

  // cache de mascaras por geometria (maskKey)
  const maskCache = new Map<string, Partial<Record<Deg, RotMask>>>();
  const concaveCache = new Map<string, boolean>();

  function rotationsFor(key: string, outer: Point2D[][], w: number, h: number): RotMask[] {
    let fill = concaveCache.get(key);
    if (fill === undefined) {
      const f = loopsArea(outer) / (w * h);
      const concave = isFinite(f) && f < 0.92;
      concaveCache.set(key, concave);
      fill = concave;
    }
    const concave = fill;
    const rots: Deg[] = concave ? [0, 90, 180, 270] : [0, 90];
    const entry = maskCache.get(key) || {};
    const out: RotMask[] = [];
    const base = entry[0]?.mask || rasterizeLoops(outer, w, h, cell);
    for (const rot of rots) {
      if (!entry[rot]) {
        const m = rot === 0 ? base : rotateMask(base, rot);
        entry[rot] = { mask: m, bprof: bottomProfile(m), tprof: topProfile(m), rot };
      }
      out.push(entry[rot]!);
    }
    if (!entry[0]) entry[0] = { mask: base, bprof: bottomProfile(base), tprof: topProfile(base), rot: 0 };
    maskCache.set(key, entry);
    return out;
  }

  // ordena as pecas por maior dimensao (maiores primeiro = melhor empacotamento)
  const order = parts
    .map((p, i) => ({ p, i, big: Math.max(p.w, p.h) * 1e6 + p.w * p.h }))
    .sort((a, b) => b.big - a.big || (a.i - b.i));

  const sheets: NestSheet[] = [];
  const unplaced: string[] = [];

  // estado de uma chapa
  interface SheetState { occ: Uint8Array; skyline: Int32Array; sheet: NestSheet; }
  function newSheet(): SheetState {
    const occ = new Uint8Array(cols * rows);
    const skyline = new Int32Array(cols);
    // Apenas a borda inferior e ocupada (o "chao" fica na margem). As margens
    // esquerda/direita sao garantidas pelo range de ancora, e a superior pelo
    // limite de altura em tryPlace. Marcar as outras bordas corromperia o scan do
    // skyline (acharia a coluna cheia ate o topo).
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < margin; r++) occ[r * cols + c] = 1;
    for (let c = 0; c < cols; c++) skyline[c] = margin;
    const sheet: NestSheet = { placements: [], usedAreaMm2: 0 };
    return { occ, skyline, sheet };
  }

  function stamp(st: SheetState, m: Mask, baseC: number, baseR: number) {
    const { occ, skyline } = st;
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        if (!m.data[r * m.cols + c]) continue;
        for (const [dr, dc] of offs) {
          const rr = baseR + r + dr, cc = baseC + c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          occ[rr * cols + cc] = 1;
        }
      }
    }
    // atualiza skyline nas colunas afetadas (inclui halo)
    const c0 = Math.max(0, baseC - gapCells), c1 = Math.min(cols - 1, baseC + m.cols + gapCells);
    for (let c = c0; c <= c1; c++) {
      let top = skyline[c];
      for (let r = rows - 1; r >= top; r--) { if (occ[r * cols + c]) { top = r + 1; break; } }
      skyline[c] = top;
    }
  }

  // tenta posicionar uma peca numa chapa; retorna placement ou null
  function tryPlace(st: SheetState, rm: RotMask): { c: number; r: number } | null {
    const { skyline } = st;
    const m = rm.mask;
    const w = m.cols;
    if (w > cols - 2 * margin || m.rows > rows - 2 * margin) return null;
    let best: { c: number; r: number; top: number } | null = null;
    for (let anchorC = margin; anchorC <= cols - margin - w; anchorC++) {
      // menor R tal que a peca fique acima do skyline em toda coluna com conteudo
      let R = margin;
      for (let pc = 0; pc < w; pc++) {
        if (rm.bprof[pc] >= m.rows) continue; // coluna da peca vazia
        const need = skyline[anchorC + pc] - rm.bprof[pc];
        if (need > R) R = need;
      }
      if (R + m.rows > rows - margin) continue;
      const top = R + m.rows;
      if (!best || top < best.top || (top === best.top && anchorC < best.c)) {
        best = { c: anchorC, r: R, top };
      }
    }
    return best ? { c: best.c, r: best.r } : null;
  }

  // chapas abertas (tentamos colocar na mais antiga que couber, senao nova)
  const states: SheetState[] = [];

  for (const { p } of order) {
    const rots = rotationsFor(p.maskKey, p.outer, p.w, p.h);
    let placed = false;

    for (const st of states) {
      let bestRot: RotMask | null = null;
      let bestPos: { c: number; r: number } | null = null;
      for (const rm of rots) {
        const pos = tryPlace(st, rm);
        if (pos) {
          const top = pos.r + rm.mask.rows;
          if (!bestPos || top < (bestPos.r + bestRot!.mask.rows)) { bestPos = pos; bestRot = rm; }
        }
      }
      if (bestPos && bestRot) {
        stamp(st, bestRot.mask, bestPos.c, bestPos.r);
        st.sheet.placements.push({
          id: p.id, maskKey: p.maskKey,
          x: bestPos.c * cell, y: bestPos.r * cell,
          w: bestRot.rot === 90 || bestRot.rot === 270 ? p.h : p.w,
          h: bestRot.rot === 90 || bestRot.rot === 270 ? p.w : p.h,
          rot: bestRot.rot,
        });
        st.sheet.usedAreaMm2 += loopsArea(p.outer);
        placed = true;
        break;
      }
    }

    if (!placed) {
      // nova chapa
      const st = newSheet();
      let bestRot: RotMask | null = null;
      let bestPos: { c: number; r: number } | null = null;
      for (const rm of rots) {
        const pos = tryPlace(st, rm);
        if (pos) {
          const top = pos.r + rm.mask.rows;
          if (!bestPos || top < (bestPos.r + bestRot!.mask.rows)) { bestPos = pos; bestRot = rm; }
        }
      }
      if (bestPos && bestRot) {
        stamp(st, bestRot.mask, bestPos.c, bestPos.r);
        st.sheet.placements.push({
          id: p.id, maskKey: p.maskKey,
          x: bestPos.c * cell, y: bestPos.r * cell,
          w: bestRot.rot === 90 || bestRot.rot === 270 ? p.h : p.w,
          h: bestRot.rot === 90 || bestRot.rot === 270 ? p.w : p.h,
          rot: bestRot.rot,
        });
        st.sheet.usedAreaMm2 += loopsArea(p.outer);
        states.push(st);
        sheets.push(st.sheet);
      } else {
        unplaced.push(p.id); // nao cabe nem numa chapa vazia
      }
    }
  }

  return { sheets, unplaced, cell };
}
