import {
  LWPolyline,
  LWPolylineVertex,
  SanitizationWarning,
  TemplateDefinition,
} from '../types/cad';

export const BULGE_90_CCW = Math.tan((Math.PI / 2) / 4); // ~0.41421356
export const BULGE_180_CCW = 1.0;
export const MIN_WALL_GAP = 3.5; // Espessura mínima de parede para corte térmico e estabilidade estrutural

/**
 * Single source of truth for resolving sheet thickness without arbitrary fallbacks
 */
export function resolveThickness(
  template: TemplateDefinition,
  params: Record<string, number>
): number {
  if (typeof params.thickness === 'number' && !Number.isNaN(params.thickness)) {
    return params.thickness;
  }
  if (typeof template.defaultParams?.thickness === 'number') {
    return template.defaultParams.thickness;
  }
  return 3.0;
}

/**
 * Creates a rectangle LWPolyline with optional Fillets or Chamfers
 */
export function createRectangularContour(
  width: number,
  height: number,
  filletRadius: number = 0,
  chamferSize: number = 0
): LWPolyline {
  const halfW = width / 2;
  const halfH = height / 2;

  // Max allowable fillet/chamfer
  const maxCorner = Math.max(0, Math.min(halfW, halfH) - 0.5);
  const r = Math.min(filletRadius, maxCorner);
  const c = Math.min(chamferSize, maxCorner);

  if (r > 0.05) {
    // 4 lines + 4 fillets (90 deg CCW arcs)
    const vertices: LWPolylineVertex[] = [
      // Bottom edge: from bottom-left corner end to bottom-right corner start
      { x: -halfW + r, y: -halfH, bulge: 0 },
      { x: halfW - r, y: -halfH, bulge: BULGE_90_CCW },
      // Right edge
      { x: halfW, y: -halfH + r, bulge: 0 },
      { x: halfW, y: halfH - r, bulge: BULGE_90_CCW },
      // Top edge
      { x: halfW - r, y: halfH, bulge: 0 },
      { x: -halfW + r, y: halfH, bulge: BULGE_90_CCW },
      // Left edge
      { x: -halfW, y: halfH - r, bulge: 0 },
      { x: -halfW, y: -halfH + r, bulge: BULGE_90_CCW },
    ];
    return { vertices, isClosed: true, layer: 'CUT' };
  } else if (c > 0.05) {
    // 8 vertices chamfered
    const vertices: LWPolylineVertex[] = [
      { x: -halfW + c, y: -halfH, bulge: 0 },
      { x: halfW - c, y: -halfH, bulge: 0 },
      { x: halfW, y: -halfH + c, bulge: 0 },
      { x: halfW, y: halfH - c, bulge: 0 },
      { x: halfW - c, y: halfH, bulge: 0 },
      { x: -halfW + c, y: halfH, bulge: 0 },
      { x: -halfW, y: halfH - c, bulge: 0 },
      { x: -halfW, y: -halfH + c, bulge: 0 },
    ];
    return { vertices, isClosed: true, layer: 'CUT' };
  } else {
    // Sharp rectangle
    const vertices: LWPolylineVertex[] = [
      { x: -halfW, y: -halfH, bulge: 0 },
      { x: halfW, y: -halfH, bulge: 0 },
      { x: halfW, y: halfH, bulge: 0 },
      { x: -halfW, y: halfH, bulge: 0 },
    ];
    return { vertices, isClosed: true, layer: 'CUT' };
  }
}

/**
 * Creates a continuous LWPolyline slot (oblong hole) with 2 semicircles
 */
export function createSlotPolyline(
  centerX: number,
  centerY: number,
  length: number,
  width: number,
  vertical: boolean = false
): LWPolyline {
  const r = width / 2;
  const straightLength = Math.max(0.1, length - width);
  const halfStraight = straightLength / 2;

  if (vertical) {
    // Vertical slot
    const vertices: LWPolylineVertex[] = [
      { x: centerX + r, y: centerY - halfStraight, bulge: 0 },
      { x: centerX + r, y: centerY + halfStraight, bulge: BULGE_180_CCW },
      { x: centerX - r, y: centerY + halfStraight, bulge: 0 },
      { x: centerX - r, y: centerY - halfStraight, bulge: BULGE_180_CCW },
    ];
    return { vertices, isClosed: true, layer: 'CUT' };
  } else {
    // Horizontal slot
    const vertices: LWPolylineVertex[] = [
      { x: centerX - halfStraight, y: centerY - r, bulge: 0 },
      { x: centerX + halfStraight, y: centerY - r, bulge: BULGE_180_CCW },
      { x: centerX + halfStraight, y: centerY + r, bulge: 0 },
      { x: centerX - halfStraight, y: centerY + r, bulge: BULGE_180_CCW },
    ];
    return { vertices, isClosed: true, layer: 'CUT' };
  }
}

/**
 * Propagates warnings from sheet metal bend calculations to the GeometryResult warnings list
 */
export function propagateBendWarnings(
  bendResult: { warnings?: string[] } | undefined,
  targetWarnings: SanitizationWarning[]
) {
  if (!bendResult?.warnings || bendResult.warnings.length === 0) return;
  for (const msg of bendResult.warnings) {
    let field = 'kFactor';
    const lower = msg.toLowerCase();
    if (lower.includes('fator k') || lower.includes('kfactor')) {
      field = 'kFactor';
    } else if (lower.includes('ângulo') || lower.includes('angulo') || lower.includes('angle')) {
      field = 'bendAngle';
    } else if (lower.includes('espessura') || lower.includes('thickness')) {
      field = 'thickness';
    } else if (lower.includes('raio') || lower.includes('radius')) {
      field = 'innerRadius';
    }
    if (!targetWarnings.some((w) => w.message === msg)) {
      targetWarnings.push({
        field,
        message: msg,
        type: 'correction',
      });
    }
  }
}

/**
 * Interface representing an oriented oblong slot capsule for exact collision testing
 */
export interface SlotCapsule {
  x: number;
  y: number;
  length: number;
  width: number;
  vertical: boolean;
}

/**
 * Calculates exact shortest distance from a 2D point to an oblong slot boundary
 */
export function distancePointToSlot(px: number, py: number, slot: SlotCapsule): number {
  const r = slot.width / 2;
  const straightLength = Math.max(0.01, slot.length - slot.width);
  const halfStraight = straightLength / 2;

  let distToCenterline: number;
  if (slot.vertical) {
    const clampedY = Math.max(slot.y - halfStraight, Math.min(slot.y + halfStraight, py));
    distToCenterline = Math.hypot(px - slot.x, py - clampedY);
  } else {
    const clampedX = Math.max(slot.x - halfStraight, Math.min(slot.x + halfStraight, px));
    distToCenterline = Math.hypot(px - clampedX, py - slot.y);
  }

  return Math.max(0, distToCenterline - r);
}

/**
 * Tests whether a circular hole of given radius collides with a slot capsule respecting MIN_WALL_GAP
 */
export function checkCircleCollidesWithSlot(
  cx: number,
  cy: number,
  radius: number,
  slot: SlotCapsule,
  minWallGap: number = MIN_WALL_GAP
): boolean {
  const dist = distancePointToSlot(cx, cy, slot);
  return dist < radius + minWallGap;
}
