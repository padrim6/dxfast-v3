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

export interface ApplyGridHolesParams {
  plateWidth: number;
  plateHeight: number;
  gridParams: Record<string, any>;
  filletR?: number;
  centerHoleR?: number;
  cornerHoleCenters?: { x: number; y: number; r: number }[];
  slotCapsules?: SlotCapsule[];
  boltHoles?: { x: number; y: number; r: number }[];
}

export interface GridHolesResult {
  circles: CircleElement[];
  perimeter: number;
  area: number;
  piercings: number;
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
}

export function applyGridHoles(
  params: ApplyGridHolesParams
): GridHolesResult {
  const {
    plateWidth: W,
    plateHeight: H,
    gridParams,
    filletR = 0,
    centerHoleR = 0,
    cornerHoleCenters = [],
    slotCapsules = [],
    boltHoles = [],
  } = params;

  const warnings: SanitizationWarning[] = [];
  const cotas: DimensionCota[] = [];
  const circles: CircleElement[] = [];

  const rows = Math.max(1, Math.min(15, Number(gridParams.rows || 1)));
  const cols = Math.max(1, Math.min(15, Number(gridParams.cols || 1)));
  const rawD = Number(gridParams.diameter || 8);
  const maxDAllowed = Math.min(rawD, Math.max(2, Math.min(W, H) / 4));
  const d = Math.max(2, maxDAllowed);
  const pitchX = Math.max(d + MIN_WALL_GAP, Number(gridParams.pitchX || 25));
  const pitchY = Math.max(d + MIN_WALL_GAP, Number(gridParams.pitchY || 25));

  const startGridX = -((cols - 1) * pitchX) / 2;
  const startGridY = -((rows - 1) * pitchY) / 2;
  const r = d / 2;
  let omittedGridHoles = 0;
  let placedGridHoles = 0;

  for (let ro = 0; ro < rows; ro++) {
    for (let co = 0; co < cols; co++) {
      const gx = startGridX + co * pitchX;
      const gy = startGridY + ro * pitchY;

      // 1. Boundary check
      const insideBounds =
        Math.abs(gx) <= W / 2 - r - MIN_WALL_GAP &&
        Math.abs(gy) <= H / 2 - r - MIN_WALL_GAP;

      if (!insideBounds) {
        omittedGridHoles++;
        continue;
      }

      // 2. Corner fillet check
      if (filletR > 0) {
        const cornerCenterX = W / 2 - filletR;
        const cornerCenterY = H / 2 - filletR;
        if (Math.abs(gx) > cornerCenterX && Math.abs(gy) > cornerCenterY) {
          const distToCornerCenter = Math.hypot(Math.abs(gx) - cornerCenterX, Math.abs(gy) - cornerCenterY);
          if (distToCornerCenter > filletR - r - MIN_WALL_GAP) {
            omittedGridHoles++;
            continue;
          }
        }
      }

      // 3. Center Hole collision check
      if (centerHoleR > 0) {
        const distToCenter = Math.hypot(gx, gy);
        if (distToCenter < centerHoleR + r + MIN_WALL_GAP) {
          omittedGridHoles++;
          continue;
        }
      }

      // 4. Corner Holes collision check
      let collidesCorner = false;
      for (const ch of cornerHoleCenters) {
        const distToCornerHole = Math.hypot(gx - ch.x, gy - ch.y);
        if (distToCornerHole < ch.r + r + MIN_WALL_GAP) {
          collidesCorner = true;
          break;
        }
      }
      if (collidesCorner) {
        omittedGridHoles++;
        continue;
      }

      // 5. Slot collision check
      let collidesSlot = false;
      for (const slot of slotCapsules) {
        if (checkCircleCollidesWithSlot(gx, gy, r, slot, MIN_WALL_GAP)) {
          collidesSlot = true;
          break;
        }
      }
      if (collidesSlot) {
        omittedGridHoles++;
        continue;
      }

      // 6. Bolt Circle check
      let collidesBolt = false;
      for (const bh of boltHoles) {
        if (Math.hypot(gx - bh.x, gy - bh.y) < bh.r + r + MIN_WALL_GAP) {
          collidesBolt = true;
          break;
        }
      }
      if (collidesBolt) {
        omittedGridHoles++;
        continue;
      }

      // Valid non-colliding hole
      circles.push({ type: 'circle', center: { x: gx, y: gy }, radius: r, layer: 'CUT' });
      placedGridHoles++;
    }
  }

  if (omittedGridHoles > 0) {
    warnings.push({
      field: 'gridHoles',
      message: `${omittedGridHoles} furo(s) da matriz foram omitidos automaticamente para preservar a integridade da peça (evitando sobreposição com rasgos, furo central ou bordas).`,
      type: 'correction',
    });
  }

  const totalPerimeter = placedGridHoles * Math.PI * d;
  const totalArea = placedGridHoles * Math.PI * r * r;

  return {
    circles,
    perimeter: totalPerimeter,
    area: totalArea,
    piercings: placedGridHoles,
    cotas,
    warnings,
  };
}
