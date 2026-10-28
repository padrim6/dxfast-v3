import {
  LWPolyline,
  DimensionCota,
  SanitizationWarning,
} from '../../types/cad';
import {
  MIN_WALL_GAP,
  createSlotPolyline,
  SlotCapsule,
} from '../helpers';

export interface ApplySlottedHolesParams {
  plateWidth: number;
  plateHeight: number;
  filletR: number;
  chamferS: number;
  slotParams: Record<string, any>;
  fallbackParams?: Record<string, number>;
}

export interface SlottedHolesResult {
  polylines: LWPolyline[];
  capsules: SlotCapsule[];
  perimeter: number;
  area: number;
  piercings: number;
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
  pattern: string;
}

export function applySlottedHoles(
  params: ApplySlottedHolesParams
): SlottedHolesResult {
  const { plateWidth: W, plateHeight: H, filletR, chamferS, slotParams, fallbackParams = {} } = params;
  const warnings: SanitizationWarning[] = [];
  const cotas: DimensionCota[] = [];
  const polylines: LWPolyline[] = [];
  const capsules: SlotCapsule[] = [];

  const rawSlotW = Number(slotParams.width || fallbackParams.slotWidth || 14);
  const rawSlotL = Number(slotParams.length || fallbackParams.slotLength || 40);
  const rawCount = Math.round(Number(slotParams.count || fallbackParams.slotCount || 4));
  const slotPattern = String(
    slotParams.pattern || (rawCount === 2 ? 'parallel_2' : rawCount === 4 ? 'corners' : 'linear_x')
  );
  const orientation = String(slotParams.orientation || 'horizontal');
  const isVertical = orientation === 'vertical' || orientation === '1';

  const maxSlotW = Math.max(3, Math.min(W, H) / 2 - MIN_WALL_GAP);
  const slotW = Math.max(3, Math.min(rawSlotW, maxSlotW));
  const maxSlotL = Math.max(slotW, Math.max(W, H) - 2 * MIN_WALL_GAP);
  const slotL = Math.max(slotW, Math.min(rawSlotL, maxSlotL));

  const count = Math.max(1, Math.min(12, rawCount));
  const slotPerimeter = 2 * (slotL - slotW) + Math.PI * slotW;
  const slotArea = (slotL - slotW) * slotW + Math.PI * (slotW / 2) * (slotW / 2);

  const dx = isVertical ? slotW : slotL;
  const dy = isVertical ? slotL : slotW;

  // Spacings & Margins
  const defaultSpX = W - 2 * (Number(slotParams.marginX || 25) + dx / 2);
  const defaultSpY = H - 2 * (Number(slotParams.marginY || 25) + dy / 2);
  const spX = Number(slotParams.spacingX || fallbackParams.slotSpacingX || defaultSpX);
  const spY = Number(slotParams.spacingY || fallbackParams.slotSpacingY || defaultSpY);

  const slotPositions: { x: number; y: number }[] = [];

  if (slotPattern === 'corners' || slotPattern === '4_corners' || (slotPattern === '' && count === 4)) {
    let halfSx = Math.max(dx / 2 + MIN_WALL_GAP, Math.min(W / 2 - dx / 2 - MIN_WALL_GAP, Math.abs(spX) / 2));
    let halfSy = Math.max(dy / 2 + MIN_WALL_GAP, Math.min(H / 2 - dy / 2 - MIN_WALL_GAP, Math.abs(spY) / 2));

    // Corner Fillet Protection: Ensure slot ends stay safely inside the rounded corner
    if (filletR > 0) {
      const cornerArcCenterX = W / 2 - filletR;
      const cornerArcCenterY = H / 2 - filletR;
      const outerTipX = halfSx + dx / 2;
      const outerTipY = halfSy + dy / 2;

      if (outerTipX > cornerArcCenterX && outerTipY > cornerArcCenterY) {
        const distToArcCenter = Math.hypot(outerTipX - cornerArcCenterX, outerTipY - cornerArcCenterY);
        if (distToArcCenter > filletR - MIN_WALL_GAP) {
          const maxAllowedOut = filletR - MIN_WALL_GAP;
          const scale = maxAllowedOut / distToArcCenter;
          halfSx = Math.max(dx / 2 + MIN_WALL_GAP, cornerArcCenterX + (outerTipX - cornerArcCenterX) * scale - dx / 2);
          halfSy = Math.max(dy / 2 + MIN_WALL_GAP, cornerArcCenterY + (outerTipY - cornerArcCenterY) * scale - dy / 2);
        }
      }
    }

    // Corner Chamfer Protection
    if (chamferS > 0) {
      const outerTipX = halfSx + dx / 2;
      const outerTipY = halfSy + dy / 2;
      const maxDiagonal = W / 2 + H / 2 - chamferS - MIN_WALL_GAP;
      if (outerTipX + outerTipY > maxDiagonal) {
        const excess = (outerTipX + outerTipY - maxDiagonal) / 2;
        halfSx = Math.max(dx / 2 + MIN_WALL_GAP, halfSx - excess);
        halfSy = Math.max(dy / 2 + MIN_WALL_GAP, halfSy - excess);
      }
    }

    slotPositions.push(
      { x: -halfSx, y: -halfSy },
      { x: halfSx, y: -halfSy },
      { x: halfSx, y: halfSy },
      { x: -halfSx, y: halfSy }
    );
  } else if (slotPattern === 'parallel_2' || (slotPattern === '' && count === 2)) {
    if (isVertical) {
      const halfSx = Math.max(dx / 2 + MIN_WALL_GAP, Math.min(W / 2 - dx / 2 - MIN_WALL_GAP, Math.abs(spX) / 2));
      slotPositions.push({ x: -halfSx, y: 0 }, { x: halfSx, y: 0 });
    } else {
      const halfSy = Math.max(dy / 2 + MIN_WALL_GAP, Math.min(H / 2 - dy / 2 - MIN_WALL_GAP, Math.abs(spY) / 2));
      slotPositions.push({ x: 0, y: -halfSy }, { x: 0, y: halfSy });
    }
  } else if (slotPattern === 'linear_x') {
    const avail = Math.max(0, W - dx - 2 * MIN_WALL_GAP);
    const step = count > 1 ? Math.min(avail / (count - 1), Math.abs(spX) / Math.max(1, count - 1)) : 0;
    const startX = -((count - 1) * step) / 2;
    for (let i = 0; i < count; i++) {
      slotPositions.push({ x: startX + i * step, y: 0 });
    }
  } else if (slotPattern === 'linear_y') {
    const avail = Math.max(0, H - dy - 2 * MIN_WALL_GAP);
    const step = count > 1 ? Math.min(avail / (count - 1), Math.abs(spY) / Math.max(1, count - 1)) : 0;
    const startY = -((count - 1) * step) / 2;
    for (let i = 0; i < count; i++) {
      slotPositions.push({ x: 0, y: startY + i * step });
    }
  } else if (slotPattern === 'grid') {
    const rows = Math.max(1, Math.min(4, Math.round(Math.sqrt(count))));
    const cols = Math.max(1, Math.min(4, Math.ceil(count / rows)));
    const maxAvailX = W - dx - 2 * MIN_WALL_GAP;
    const maxAvailY = H - dy - 2 * MIN_WALL_GAP;
    const stepX = cols > 1 ? Math.min(maxAvailX / (cols - 1), Math.abs(spX) / (cols - 1)) : 0;
    const stepY = rows > 1 ? Math.min(maxAvailY / (rows - 1), Math.abs(spY) / (rows - 1)) : 0;
    const startX = -((cols - 1) * stepX) / 2;
    const startY = -((rows - 1) * stepY) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slotPositions.push({ x: startX + c * stepX, y: startY + r * stepY });
      }
    }
  }

  // Generate each slot polyline and register capsule
  slotPositions.forEach((pos) => {
    polylines.push(createSlotPolyline(pos.x, pos.y, slotL, slotW, isVertical));
    capsules.push({
      x: pos.x,
      y: pos.y,
      length: slotL,
      width: slotW,
      vertical: isVertical,
    });
  });

  const totalPerimeter = slotPositions.length * slotPerimeter;
  const totalArea = slotPositions.length * slotArea;
  const piercings = slotPositions.length;

  // Add dimension cotas for slots
  if (slotPositions.length >= 2) {
    if (slotPattern === 'corners' || slotPattern === '4_corners') {
      const p0 = slotPositions[0];
      const p1 = slotPositions[1];
      const p2 = slotPositions[2];
      cotas.push({
        type: 'linear',
        start: { x: p0.x, y: p0.y },
        end: { x: p1.x, y: p1.y },
        label: `${Math.abs(p1.x - p0.x).toFixed(1)} mm (Rasgos C-C X)`,
        valueMm: Math.abs(p1.x - p0.x),
        orientation: 'horizontal',
        offset: -20,
      });
      cotas.push({
        type: 'linear',
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        label: `${Math.abs(p2.y - p1.y).toFixed(1)} mm (Rasgos C-C Y)`,
        valueMm: Math.abs(p2.y - p1.y),
        orientation: 'vertical',
        offset: 20,
      });
    }
  }

  return {
    polylines,
    capsules,
    perimeter: totalPerimeter,
    area: totalArea,
    piercings,
    cotas,
    warnings,
    pattern: slotPattern,
  };
}
