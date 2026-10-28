// DXFAST :: Rasterizacao da silhueta da peca para o encaixe aos pares
// Converte o contorno externo (poligonal, ja tesselizado) numa mascara de celulas
// e oferece rotacoes de 90/180/270 graus e perfis de coluna. Puro e deterministico.
// Apenas a silhueta EXTERNA importa para o encaixe (furos sao ignorados: nunca se
// posiciona outra peca dentro de um furo). Proibido o caractere traco-longo.

import { Point2D } from '../types/cad';

export interface Mask {
  cols: number;
  rows: number;
  cell: number; // mm por celula
  data: Uint8Array; // 1 = ocupado; indice = r*cols + c (c no eixo x, r no eixo y para cima)
}

// Resolucao adaptativa: limita a mascara a ~180 celulas no maior lado (equilibrio
// entre fidelidade do encaixe e custo da dilatacao em disco).
export function chooseCell(w: number, h: number): number {
  const maxDim = Math.max(w, h);
  const cell = maxDim / 180;
  if (cell < 0.6) return 0.6;
  if (cell > 4) return 4;
  return cell;
}

/**
 * Rasteriza um conjunto de lacos externos (coordenadas locais em [0,w]x[0,h], y
 * para cima) por scanline com regra par-impar. c cresce com x; r cresce com y.
 */
export function rasterizeLoops(outer: Point2D[][], w: number, h: number, cell: number): Mask {
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const data = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * cell;
    const xs: number[] = [];
    for (const loop of outer) {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % n];
        const ay = a.y;
        const by = b.y;
        // aresta cruza a linha horizontal y?
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y - ay) / (by - ay);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k];
      const x1 = xs[k + 1];
      let c0 = Math.floor(x0 / cell);
      let c1 = Math.ceil(x1 / cell) - 1;
      if (c0 < 0) c0 = 0;
      if (c1 > cols - 1) c1 = cols - 1;
      for (let c = c0; c <= c1; c++) {
        // centro da celula dentro do span?
        const xc = (c + 0.5) * cell;
        if (xc >= x0 && xc <= x1) data[r * cols + c] = 1;
      }
    }
  }
  return { cols, rows, cell, data };
}

/** Rotaciona a mascara 90/180/270 graus (anti-horario). */
export function rotateMask(mask: Mask, deg: 0 | 90 | 180 | 270): Mask {
  if (deg === 0) return mask;
  const { cols, rows, cell, data } = mask;
  if (deg === 180) {
    const out = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        out[(rows - 1 - r) * cols + (cols - 1 - c)] = data[r * cols + c];
    return { cols, rows, cell, data: out };
  }
  // 90 ou 270: dimensoes trocam. Convencao casada com o transform de desenho:
  //   rot90 (CCW):  (u,v) -> (H-v, u)  => indice (c,r) -> (nc=rows-1-r, nr=c)
  //   rot270 (CCW): (u,v) -> (v, W-u)  => indice (c,r) -> (nc=r,        nr=cols-1-c)
  const nc = rows; // novo numero de colunas
  const nr = cols; // novo numero de linhas
  const out = new Uint8Array(nc * nr);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!data[r * cols + c]) continue;
      let ncIdx: number;
      let nrIdx: number;
      if (deg === 90) {
        ncIdx = rows - 1 - r;
        nrIdx = c;
      } else {
        ncIdx = r;
        nrIdx = cols - 1 - c;
      }
      out[nrIdx * nc + ncIdx] = 1;
    }
  }
  return { cols: nc, rows: nr, cell, data: out };
}

/**
 * Perfil superior por coluna: para cada coluna c, o indice de linha da celula
 * ocupada mais alta (maior r), ou -1 se a coluna esta vazia.
 */
export function topProfile(mask: Mask): Int32Array {
  const { cols, rows, data } = mask;
  const prof = new Int32Array(cols).fill(-1);
  for (let c = 0; c < cols; c++) {
    for (let r = rows - 1; r >= 0; r--) {
      if (data[r * cols + c]) {
        prof[c] = r;
        break;
      }
    }
  }
  return prof;
}

/**
 * Perfil inferior por coluna: para cada coluna c, o indice de linha da celula
 * ocupada mais baixa (menor r), ou +infinito (rows) se vazia.
 */
export function bottomProfile(mask: Mask): Int32Array {
  const { cols, rows, data } = mask;
  const prof = new Int32Array(cols).fill(rows); // rows = "vazio"
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (data[r * cols + c]) {
        prof[c] = r;
        break;
      }
    }
  }
  return prof;
}

/** Conta celulas ocupadas (area aproximada em celulas). */
export function countCells(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) n++;
  return n;
}
