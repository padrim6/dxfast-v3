// DXFAST :: Layout universal de cotas (de-conflito + referencia auto-ocultas)
// Passada pura sobre o array generico de cotas, valida para todos os templates.
// Principais (externas e entre centros) sempre visiveis, empilhadas em offsets
// crescentes ate nao colidirem. Referencia "(ref)" cede: some quando colidiria.
// Trabalha em mm (coordenadas das cotas); o consumidor aplica a escala de tela.
// Deterministica: mesma entrada, mesma saida. Proibido o caractere traco-longo.

import { DimensionCota } from '../types/cad';

export type CotaRole = 'primary' | 'reference';

export interface LaidOutCota {
  cota: DimensionCota;
  role: CotaRole;
  resolvedOffset: number;
  hidden: boolean;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LayoutOpts {
  charWidthMm?: number;
  labelHeightMm?: number;
  approxCharWidthMm?: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function midpoint(c: DimensionCota): { x: number; y: number } {
  return { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 };
}

// Deriva a orientacao efetiva de uma cota quando ela nao vem explicita.
function effectiveOrientation(c: DimensionCota): 'horizontal' | 'vertical' | 'aligned' {
  if (c.orientation) return c.orientation;
  const dx = Math.abs(c.end.x - c.start.x);
  const dy = Math.abs(c.end.y - c.start.y);
  if (dx >= dy) return 'horizontal';
  return 'vertical';
}

// Caixa aproximada do rotulo para um offset de teste.
function labelBox(
  c: DimensionCota,
  offset: number,
  center: { x: number; y: number },
  charWidthMm: number,
  labelHeightMm: number
): Box {
  const labelWidth = Math.max(labelHeightMm, (c.label?.length || 1) * charWidthMm);
  const mid = midpoint(c);
  const orient = effectiveOrientation(c);

  if (orient === 'horizontal') {
    const signY = mid.y >= center.y ? 1 : -1;
    const cy = mid.y + signY * offset;
    const cx = mid.x;
    return {
      minX: cx - labelWidth / 2,
      maxX: cx + labelWidth / 2,
      minY: cy - labelHeightMm / 2,
      maxY: cy + labelHeightMm / 2,
    };
  }

  if (orient === 'vertical') {
    const signX = mid.x >= center.x ? 1 : -1;
    const cx = mid.x + signX * offset;
    const cy = mid.y;
    // rotulo da cota vertical ocupa mais no eixo Y
    return {
      minX: cx - labelHeightMm / 2,
      maxX: cx + labelHeightMm / 2,
      minY: cy - labelWidth / 2,
      maxY: cy + labelWidth / 2,
    };
  }

  // aligned / diameter / radius / angle: afasta radialmente do centro da peca
  const dirX = mid.x - center.x;
  const dirY = mid.y - center.y;
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const cx = mid.x + ux * offset;
  const cy = mid.y + uy * offset;
  return {
    minX: cx - labelWidth / 2,
    maxX: cx + labelWidth / 2,
    minY: cy - labelHeightMm / 2,
    maxY: cy + labelHeightMm / 2,
  };
}

export function layoutDimensions(
  cotas: DimensionCota[],
  bbox: BBox,
  opts?: LayoutOpts
): LaidOutCota[] {
  const charWidthMm = opts?.charWidthMm ?? opts?.approxCharWidthMm ?? 6;
  const labelHeightMm = opts?.labelHeightMm ?? 9;
  const center = {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2,
  };
  const step = labelHeightMm * 1.6;

  const results: LaidOutCota[] = new Array(cotas.length);
  const placedBoxes: Box[] = [];

  // 1. Principais primeiro (nunca se escondem; ganham o espaco empilhando offset).
  cotas.forEach((cota, idx) => {
    const isRef = (cota.label || '').toLowerCase().includes('(ref)');
    if (isRef) return; // referencia tratada na segunda passada

    const baseOffset = cota.offset ?? labelHeightMm * 1.6;
    let offset = baseOffset;
    let box = labelBox(cota, offset, center, charWidthMm, labelHeightMm);
    let guard = 0;
    while (placedBoxes.some((b) => boxesOverlap(b, box)) && guard < 40) {
      offset += step;
      box = labelBox(cota, offset, center, charWidthMm, labelHeightMm);
      guard++;
    }
    placedBoxes.push(box);
    results[idx] = { cota, role: 'primary', resolvedOffset: offset, hidden: false };
  });

  // 2. Referencia depois: posiciona se couber, senao oculta.
  cotas.forEach((cota, idx) => {
    const isRef = (cota.label || '').toLowerCase().includes('(ref)');
    if (!isRef) return;

    const baseOffset = cota.offset ?? labelHeightMm * 1.4;
    const box = labelBox(cota, baseOffset, center, charWidthMm, labelHeightMm);
    const collides = placedBoxes.some((b) => boxesOverlap(b, box));
    if (collides) {
      results[idx] = { cota, role: 'reference', resolvedOffset: baseOffset, hidden: true };
    } else {
      placedBoxes.push(box);
      results[idx] = { cota, role: 'reference', resolvedOffset: baseOffset, hidden: false };
    }
  });

  return results;
}
