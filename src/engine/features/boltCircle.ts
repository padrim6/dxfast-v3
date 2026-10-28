import {
  CircleElement,
  DimensionCota,
  SanitizationWarning,
} from '../../types/cad';
import {
  MIN_WALL_GAP,
  SlotCapsule,
  checkCircleCollidesWithSlot,
} from '../helpers';

export interface ApplyBoltCircleParams {
  plateWidth: number;
  plateHeight: number;
  bcdParams: Record<string, any>;
  centerHoleR?: number;
  cornerHoleCenters?: { x: number; y: number; r: number }[];
  slotCapsules?: SlotCapsule[];
  startAngleDeg?: number;
}

export interface BoltCircleResult {
  circles: CircleElement[];
  boltHoles: { x: number; y: number; r: number }[];
  perimeter: number;
  area: number;
  piercings: number;
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
}

export function applyBoltCircle(
  params: ApplyBoltCircleParams
): BoltCircleResult {
  const {
    plateWidth: W,
    plateHeight: H,
    bcdParams,
    centerHoleR = 0,
    cornerHoleCenters = [],
    slotCapsules = [],
    startAngleDeg = 0,
  } = params;

  const warnings: SanitizationWarning[] = [];
  const cotas: DimensionCota[] = [];
  const circles: CircleElement[] = [];
  const boltHoles: { x: number; y: number; r: number }[] = [];

  const bcd = Number(bcdParams.bcd || 120);
  const bcdCount = Math.max(1, Math.min(24, Math.round(Number(bcdParams.count || 4))));
  const bcdDia = Math.max(2, Number(bcdParams.diameter || 12));
  const bcdR = bcd / 2;
  const holeR = bcdDia / 2;
  let omittedBcd = 0;

  const startAngleRad = (startAngleDeg * Math.PI) / 180;

  for (let i = 0; i < bcdCount; i++) {
    const ang = startAngleRad + (i * 2 * Math.PI) / bcdCount;
    const bx = bcdR * Math.cos(ang);
    const by = bcdR * Math.sin(ang);

    // 1. Boundary check
    if (Math.abs(bx) > W / 2 - holeR - MIN_WALL_GAP || Math.abs(by) > H / 2 - holeR - MIN_WALL_GAP) {
      omittedBcd++;
      continue;
    }

    // 2. Center hole check
    if (centerHoleR > 0 && Math.hypot(bx, by) < centerHoleR + holeR + MIN_WALL_GAP) {
      omittedBcd++;
      continue;
    }

    // 3. Corner holes check
    let collidesCorner = false;
    for (const ch of cornerHoleCenters) {
      if (Math.hypot(bx - ch.x, by - ch.y) < ch.r + holeR + MIN_WALL_GAP) {
        collidesCorner = true;
        break;
      }
    }
    if (collidesCorner) {
      omittedBcd++;
      continue;
    }

    // 4. Slot capsules check
    let collidesSlot = false;
    for (const slot of slotCapsules) {
      if (checkCircleCollidesWithSlot(bx, by, holeR, slot, MIN_WALL_GAP)) {
        collidesSlot = true;
        break;
      }
    }
    if (collidesSlot) {
      omittedBcd++;
      continue;
    }

    circles.push({ type: 'circle', center: { x: bx, y: by }, radius: holeR, layer: 'CUT' });
    boltHoles.push({ x: bx, y: by, r: holeR });
  }

  if (omittedBcd > 0) {
    warnings.push({
      field: 'boltCircle',
      message: `${omittedBcd} furo(s) do círculo primitivo (BCD) foram omitidos por colisão com outros elementos.`,
      type: 'correction',
    });
  }

  const totalPerimeter = boltHoles.length * Math.PI * bcdDia;
  const totalArea = boltHoles.length * Math.PI * holeR * holeR;
  const piercings = boltHoles.length;

  return {
    circles,
    boltHoles,
    perimeter: totalPerimeter,
    area: totalArea,
    piercings,
    cotas,
    warnings,
  };
}
