import {
  TemplateDefinition,
  FeatureState,
  FeatureId,
  GeometryResult,
  LWPolyline,
  LWPolylineVertex,
  CircleElement,
  BendLine,
  FaceSectionInfo,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
  Point2D,
} from '../types/cad';
import { calculateBendParameters, calculateProfileBlank } from '../utils/bendMath';
import { measureBoundingBox, measureGeometry } from '../utils/geometryMeasure';
import { validateGeometry } from './validator';
import { getTemplateSolver } from './templateRegistry';
import { resolveThickness } from './helpers';
import './templates';

const BULGE_90_CCW = Math.tan((Math.PI / 2) / 4); // ~0.41421356
const BULGE_180_CCW = 1.0;
const MIN_WALL_GAP = 3.5; // Espessura mínima de parede para corte térmico e estabilidade estrutural

/**
 * Samples vertices of a polyline, including arcs defined by bulge factor
 */
function samplePolyline(poly: LWPolyline, segmentsPerArc: number = 24): Point2D[] {
  const verts = poly.vertices;
  if (!verts || verts.length === 0) return [];
  const points: Point2D[] = [];
  const n = verts.length;
  const count = poly.isClosed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    points.push({ x: v1.x, y: v1.y });

    const bulge = v1.bulge || 0;
    if (Math.abs(bulge) > 1e-6) {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-6) {
        const theta = 4 * Math.atan(bulge);
        const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
        const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
        const midX = (v1.x + v2.x) / 2;
        const midY = (v1.y + v2.y) / 2;
        const perpX = -dy / chord;
        const perpY = dx / chord;
        const cx = midX + h * perpX;
        const cy = midY + h * perpY;
        const startAngle = Math.atan2(v1.y - cy, v1.x - cx);

        for (let s = 1; s < segmentsPerArc; s++) {
          const t = s / segmentsPerArc;
          const angle = startAngle + t * theta;
          points.push({
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
          });
        }
      }
    }
  }

  return points;
}

/**
 * Point-in-polygon test (ray casting algorithm)
 */
function isPointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
        && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if circle crosses or lies outside the outer polygon
 */
function isCircleCrossingOuter(center: Point2D, radius: number, outerPoly: Point2D[]): boolean {
  if (radius <= 0) return false;
  if (!isPointInPolygon(center, outerPoly)) return true;

  for (let k = 0; k < 12; k++) {
    const angle = (2 * Math.PI * k) / 12;
    const pt: Point2D = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
    if (!isPointInPolygon(pt, outerPoly)) {
      return true;
    }
  }
  return false;
}

/**
 * Creates a rectangle LWPolyline with optional Fillets or Chamfers
 */
function createRectangularContour(
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
function createSlotPolyline(
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
function propagateBendWarnings(
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
interface SlotCapsule {
  x: number;
  y: number;
  length: number;
  width: number;
  vertical: boolean;
}

/**
 * Calculates exact shortest distance from a 2D point to an oblong slot boundary
 */
function distancePointToSlot(px: number, py: number, slot: SlotCapsule): number {
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
function checkCircleCollidesWithSlot(
  cx: number,
  cy: number,
  radius: number,
  slot: SlotCapsule,
  minWallGap: number = MIN_WALL_GAP
): boolean {
  const dist = distancePointToSlot(cx, cy, slot);
  return dist < radius + minWallGap;
}

/**
 * Primary Geometric Solver & Generator with Strict Anti-Error Mechanisms
 */
export function generateGeometry(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<FeatureId, FeatureState>,
  ...deprecatedArgs: any[]
): GeometryResult {
  if (deprecatedArgs.length > 0 && Array.isArray(deprecatedArgs[0]) && deprecatedArgs[0].length > 0) {
    throw new Error('Dobras personalizadas foram descontinuadas e não são mais suportadas pelo motor geométrico.');
  }

  const warnings: SanitizationWarning[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const bendLines: BendLine[] = [];
  const cotas: DimensionCota[] = [];
  let faceSections: FaceSectionInfo[] | undefined;

  let totalOuterPerimeter = 0;
  let totalInnerPerimeter = 0;
  let grossArea = 0;
  let netArea = 0;
  let piercingCount = 1; // 1 for external contour lead-in
  let bendCount = 0;
  let blankWidthMm = 0;
  let blankHeightMm = 0;
  let unfoldingMath: GeometryResult['unfoldingMath'];

  const templateId = template.id;
  const sheetThickness = resolveThickness(template, params);

  const registeredSolver = getTemplateSolver(templateId);
  if (!registeredSolver) {
    throw new Error(`Template desconhecido ou não suportado: "${templateId}".`);
  }

  const output = registeredSolver({
    template,
    params,
    features,
    sheetThickness,
  });

  outerPolylines.push(...output.outerPolylines);
  innerPolylines.push(...output.innerPolylines);
  circles.push(...output.circles);
  bendLines.push(...output.bendLines);
  if (output.faceSections) {
    faceSections = output.faceSections;
  }
  cotas.push(...output.cotas);
  warnings.push(...output.warnings);

  const measured = measureGeometry({ outerPolylines, innerPolylines, circles });
  totalOuterPerimeter = measured.outerPerimeterMm;
  totalInnerPerimeter = measured.innerPerimeterMm;
  grossArea = measured.grossAreaMm2;
  netArea = measured.netAreaMm2;

  piercingCount = output.piercingCount;
  bendCount = output.bendCount;
  blankWidthMm = output.blankWidthMm;
  blankHeightMm = output.blankHeightMm;
  unfoldingMath = output.unfoldingMath;

  // Calculate Bounding Box
  const halfW = blankWidthMm / 2;
  const halfH = blankHeightMm / 2;

  bendCount = bendLines.length;

  // Clean Essential Cotas: Ensure only primary, non-cluttering essential dimensions are on the drawing
  // If no template-specific cotas were defined, add default width and height cotas
  if (cotas.length === 0) {
    // Essential Width Cota (Top)
    if (blankWidthMm > 1) {
      cotas.push({
        type: 'linear',
        start: { x: -halfW, y: halfH },
        end: { x: halfW, y: halfH },
        label: `${blankWidthMm.toFixed(1)} mm`,
        valueMm: blankWidthMm,
        orientation: 'horizontal',
        offset: 24,
      });
    }

    // Essential Height Cota (Right)
    if (blankHeightMm > 1) {
      cotas.push({
        type: 'linear',
        start: { x: halfW, y: -halfH },
        end: { x: halfW, y: halfH },
        label: `${blankHeightMm.toFixed(1)} mm`,
        valueMm: blankHeightMm,
        orientation: 'vertical',
        offset: 24,
      });
    }
  }

  const totalPerimeterMm = totalOuterPerimeter + totalInnerPerimeter;
  const cutLengthMm = totalPerimeterMm;
  const measuredBox = measureBoundingBox({ outerPolylines, innerPolylines, circles });

  // Run extracted validation engine
  const validation = validateGeometry({
    outerPolylines,
    innerPolylines,
    circles,
    grossArea,
    netArea,
    bendLines,
    faceSections,
    unfoldingMath,
    templateId: template.id,
    params,
  });

  netArea = validation.adjustedNetArea;
  warnings.push(...validation.warnings);
  const errors = [...(output.errors || []), ...validation.errors];

  return {
    outerPolylines,
    innerPolylines,
    circles,
    bendLines,
    faceSections,
    cotas,
    boundingBox: measuredBox,
    metrics: {
      outerPerimeterMm: Number(totalOuterPerimeter.toFixed(2)),
      innerPerimeterMm: Number(totalInnerPerimeter.toFixed(2)),
      totalPerimeterMm: Number(totalPerimeterMm.toFixed(2)),
      cutLengthMm: Number(cutLengthMm.toFixed(2)),
      netAreaMm2: Number(netArea.toFixed(2)),
      grossAreaMm2: Number(grossArea.toFixed(2)),
      piercingCount,
      bendCount,
      blankWidthMm: Number(measuredBox.width.toFixed(2)),
      blankHeightMm: Number(measuredBox.height.toFixed(2)),
    },
    warnings,
    errors,
    unfoldingMath,
  };
}
