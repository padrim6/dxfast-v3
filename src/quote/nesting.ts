// DXFAST :: Nesting (aninhamento) real em faixas alinhadas + encaixe aos pares
// Pure, deterministico, SEM efeitos colaterais. Fora de src/engine/. Proibido o caractere traco-longo em qualquer string.
//
// IDEIA (simples de entender e de explicar ao cliente)
// Preenchemos a chapa com uma grade de pecas na melhor orientacao e aproveitamos
// as faixas que sobram girando as pecas 90 graus. O resultado sao blocos
// retangulares ALINHADOS (uma grade principal mais algumas faixas), nunca um
// recorte picado. E um aninhamento real (posicoes concretas) e conservador.
//
// MARGEM / ESPACAMENTO
// O mesmo valor de espacamento e aplicado em TODOS os lugares: entre pecas E como
// margem na borda da chapa. Assim sempre sobra uma pequena folga em volta de tudo
// (nada encosta na beirada), o que casa com a realidade do corte.
//
// GARANTIAS (para um orcamento honesto)
// 1. NUNCA super-estima: todas as pecas sao posicoes reais, sem sobreposicao,
//    dentro da area util (ja descontada a margem de borda).
// 2. NUNCA pior que a grade pura (com a mesma margem): a grade pura e sempre uma
//    das opcoes avaliadas; so melhora a partir dai.
// 3. Deterministico: mesma entrada, mesma saida.
// 4. Custo baixo e limitado: a busca e uma arvore rasa (profundidade fixa).

import { Point2D } from '../types/cad';
import { nestByPairs } from './pairNesting';

export interface Placement {
  x: number; // mm, canto inferior-esquerdo do footprint da peca na chapa (com margem)
  y: number; // mm
  w: number; // mm, largura do footprint (ja na orientacao final)
  h: number; // mm, altura do footprint (ja na orientacao final)
  rot: 0 | 90 | 180 | 270; // rotacao anti-horaria aplicada a peca (graus)
}

export interface NestingResult {
  count: number;
  placements: Placement[];
}

// Profundidade da busca em faixas. Cada nivel acrescenta uma faixa de
// aproveitamento alinhada. 4 ja captura quase todo o ganho mantendo o desenho
// limpo e o custo trivial (arvore com poucas centenas de nos).
const MAX_DEPTH = 4;

/**
 * Quantas pecas cabem numa grade pura dentro de WxL, com a peca ocupando
 * (pw ao longo de W) x (ph ao longo de L). gap e o espaco entre pecas.
 */
function gridFit(
  W: number,
  L: number,
  pw: number,
  ph: number,
  gap: number
): { cols: number; rows: number; count: number } {
  if (W <= 0 || L <= 0 || pw <= 0 || ph <= 0) {
    return { cols: 0, rows: 0, count: 0 };
  }
  const cols = Math.floor((W + gap) / (pw + gap));
  const rows = Math.floor((L + gap) / (ph + gap));
  const safeCols = cols > 0 ? cols : 0;
  const safeRows = rows > 0 ? rows : 0;
  return { cols: safeCols, rows: safeRows, count: safeCols * safeRows };
}

type Decision =
  | { kind: 'grid'; rotated: boolean } // grade pura uniforme
  | { kind: 'vband'; rotated: boolean; rest: Decision } // grade + faixa a direita
  | { kind: 'hband'; rotated: boolean; rest: Decision }; // grade + faixa embaixo

interface Solved {
  count: number;
  decision: Decision;
}

/**
 * Melhor leiaute em faixas alinhadas para uma area util WxL. Avalia a grade pura
 * nas duas orientacoes e, enquanto houver profundidade, tenta: encher um bloco de
 * grade e aproveitar a faixa que sobra (a direita ou embaixo) com uma recursao.
 */
function solveRegion(
  W: number,
  L: number,
  partWmm: number,
  partHmm: number,
  gap: number,
  minPiece: number,
  depth: number
): Solved {
  // Base: grade pura nas duas orientacoes.
  const g0 = gridFit(W, L, partWmm, partHmm, gap).count; // nominal
  const g1 = gridFit(W, L, partHmm, partWmm, gap).count; // girada 90
  let best: Solved =
    g1 > g0
      ? { count: g1, decision: { kind: 'grid', rotated: true } }
      : { count: g0, decision: { kind: 'grid', rotated: false } };

  if (best.count === 0 || depth <= 0) {
    return best;
  }

  // Duas orientacoes possiveis para o bloco principal.
  const orientations: Array<{ rotated: boolean; ow: number; oh: number }> = [
    { rotated: false, ow: partWmm, oh: partHmm },
    { rotated: true, ow: partHmm, oh: partWmm },
  ];

  for (const o of orientations) {
    const g = gridFit(W, L, o.ow, o.oh, gap);
    if (g.cols < 1 || g.rows < 1) continue;
    const blockCount = g.cols * g.rows;

    // Faixa a direita (ocupa a altura inteira L).
    const consumedW = g.cols * (o.ow + gap) - gap;
    const remW = W - consumedW - gap;
    if (remW >= minPiece) {
      const sub = solveRegion(remW, L, partWmm, partHmm, gap, minPiece, depth - 1);
      const total = blockCount + sub.count;
      if (total > best.count) {
        best = { count: total, decision: { kind: 'vband', rotated: o.rotated, rest: sub.decision } };
      }
    }

    // Faixa embaixo (ocupa a largura inteira W).
    const consumedH = g.rows * (o.oh + gap) - gap;
    const remH = L - consumedH - gap;
    if (remH >= minPiece) {
      const sub = solveRegion(W, remH, partWmm, partHmm, gap, minPiece, depth - 1);
      const total = blockCount + sub.count;
      if (total > best.count) {
        best = { count: total, decision: { kind: 'hband', rotated: o.rotated, rest: sub.decision } };
      }
    }
  }

  return best;
}

/**
 * Calcula o aninhamento de pecas identicas numa chapa. Ver garantias no topo.
 * O espacamento e aplicado entre pecas e tambem como margem de borda.
 */
export function nestRectangles(
  sheetWmm: number,
  sheetLmm: number,
  partWmm: number,
  partHmm: number,
  gapMm: number = 5
): NestingResult {
  if (
    sheetWmm <= 0 ||
    sheetLmm <= 0 ||
    partWmm <= 0 ||
    partHmm <= 0 ||
    !isFinite(sheetWmm) ||
    !isFinite(sheetLmm) ||
    !isFinite(partWmm) ||
    !isFinite(partHmm)
  ) {
    return { count: 0, placements: [] };
  }

  const gap = gapMm > 0 ? gapMm : 0;

  // Area util: desconta a margem de borda (= gap) de cada lado.
  const usableW = sheetWmm - 2 * gap;
  const usableL = sheetLmm - 2 * gap;
  if (usableW <= 0 || usableL <= 0) {
    return { count: 0, placements: [] };
  }

  const minPiece = Math.min(partWmm, partHmm);
  const root = solveRegion(usableW, usableL, partWmm, partHmm, gap, minPiece, MAX_DEPTH);

  // Reconstrucao das posicoes reais. offX/offY ja incluem a margem de borda.
  const placements: Placement[] = [];

  function emitGrid(
    W: number,
    L: number,
    offX: number,
    offY: number,
    rotated: boolean
  ): { consumedW: number; consumedH: number; cols: number; rows: number } {
    const pw = rotated ? partHmm : partWmm;
    const ph = rotated ? partWmm : partHmm;
    const { cols, rows } = gridFit(W, L, pw, ph, gap);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        placements.push({
          x: offX + c * (pw + gap),
          y: offY + r * (ph + gap),
          w: pw,
          h: ph,
          rot: rotated ? 90 : 0,
        });
      }
    }
    const consumedW = cols > 0 ? cols * (pw + gap) - gap : 0;
    const consumedH = rows > 0 ? rows * (ph + gap) - gap : 0;
    return { consumedW, consumedH, cols, rows };
  }

  function build(W: number, L: number, offX: number, offY: number, d: Decision): void {
    if (W <= 0 || L <= 0) return;
    if (d.kind === 'grid') {
      emitGrid(W, L, offX, offY, d.rotated);
      return;
    }
    const block = emitGrid(W, L, offX, offY, d.rotated);
    if (d.kind === 'vband') {
      const remW = W - block.consumedW - gap;
      build(remW, L, offX + block.consumedW + gap, offY, d.rest);
    } else {
      const remH = L - block.consumedH - gap;
      build(W, remH, offX, offY + block.consumedH + gap, d.rest);
    }
  }

  build(usableW, usableL, gap, gap, root.decision);

  // Fonte unica de verdade: o numero de pecas efetivamente posicionadas.
  return { count: placements.length, placements };
}

// Area de poligono(s) por formula do sapateiro (shoelace), em modulo.
function loopsArea(outer: Point2D[][]): number {
  let total = 0;
  for (const loop of outer) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      a += p.x * q.y - q.x * p.y;
    }
    total += Math.abs(a) / 2;
  }
  return total;
}

/**
 * Aninhamento da peca escolhendo o melhor entre: faixas retangulares (sempre) e
 * encaixe aos pares (quando a silhueta e concava o suficiente para compensar).
 * Conservador: so adota o par quando ele rende MAIS pecas que o retangular. O
 * resultado e sempre fisicamente valido (nunca superestima).
 *
 * @param outer silhueta externa da peca (lacos locais em [0,W]x[0,H], y para cima),
 *   normalizada a origem da bounding box. Se ausente, usa so o retangular.
 */
export function nestShape(
  sheetWmm: number,
  sheetLmm: number,
  partWmm: number,
  partHmm: number,
  gapMm: number,
  outer?: Point2D[][]
): NestingResult {
  const rect = nestRectangles(sheetWmm, sheetLmm, partWmm, partHmm, gapMm);
  if (!outer || outer.length === 0 || partWmm <= 0 || partHmm <= 0) {
    return rect;
  }
  // So tenta pares se a peca for concava o bastante (a bbox tem folga a aproveitar).
  const fill = loopsArea(outer) / (partWmm * partHmm);
  if (!isFinite(fill) || fill >= 0.95) {
    return rect;
  }
  const pair = nestByPairs(sheetWmm, sheetLmm, outer, partWmm, partHmm, gapMm);
  if (pair && pair.count > rect.count) {
    return pair;
  }
  return rect;
}

/**
 * Compatibilidade: contagem de pecas por chapa (mesma assinatura da versao antiga).
 * Agora alimentada pelo aninhamento real em faixas alinhadas, com margem de borda.
 */
export function piecesPerSheet(
  sheetWmm: number,
  sheetLmm: number,
  partWmm: number,
  partHmm: number,
  gapMm: number = 5
): number {
  return nestRectangles(sheetWmm, sheetLmm, partWmm, partHmm, gapMm).count;
}
