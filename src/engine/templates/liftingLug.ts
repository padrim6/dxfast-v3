import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  LWPolyline,
  LWPolylineVertex,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveLiftingLug(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const rawH = params.totalHeight || 180;
  const rawR_top = params.topRadius || 50;

  const R_top = Math.max(15, rawR_top);
  const H = Math.max(R_top + 25, rawH);

  if (rawH < R_top + 25) {
    warnings.push({
      field: 'totalHeight',
      message: `Altura total ajustada para ${H.toFixed(1)}mm para manter haste estrutural mínima acima do olhal.`,
      type: 'correction',
    });
  }

  const yTopCenter = H / 2 - R_top;
  const yBottom = -H / 2;
  const hCenterFromBase = H - R_top;

  // Determine Base Draft / Opening Angle (alpha)
  let alphaDeg = 15;
  if (params.baseAngle !== undefined) {
    alphaDeg = Math.max(0, Math.min(45, params.baseAngle));
  } else if (params.baseWidth !== undefined) {
    // Exact analytical closed-form conversion from legacy baseWidth B to tangent angle alpha
    const halfB_in = Math.max(R_top, params.baseWidth / 2);
    if (halfB_in > R_top) {
      const D = Math.hypot(halfB_in, hCenterFromBase);
      if (D > R_top) {
        const alphaRadComputed = Math.acos(R_top / D) - Math.atan2(hCenterFromBase, halfB_in);
        alphaDeg = Math.max(0, Math.min(45, (alphaRadComputed * 180) / Math.PI));
      } else {
        alphaDeg = 0;
      }
    } else {
      alphaDeg = 0;
    }
  }

  const alphaRad = (alphaDeg * Math.PI) / 180;

  // Exact Tangent Points on the Top Circular Head (C1 / G1 continuity)
  // Circle equation: x^2 + (y - yTopCenter)^2 = R_top^2
  // Tangent slope of lateral line: dx/dy = -tan(alpha)
  // Tangent point on circle: xTR = R_top * cos(alpha), yTR = yTopCenter + R_top * sin(alpha)
  const xTR = R_top * Math.cos(alphaRad);
  const yTR = yTopCenter + R_top * Math.sin(alphaRad);

  const xTL = -xTR;
  const yTL = yTR;

  // Vertical height from tangent points down to the base
  const deltaY = yTR - yBottom;
  const xBase = xTR + deltaY * Math.tan(alphaRad);
  const B = 2 * xBase;

  const blankWidthMm = Math.max(B, 2 * R_top);
  const blankHeightMm = H;

  // Hole sizing and safety wall thickness verification
  const rawHoleD = params.holeDiameter || 45;
  const maxSafeHoleD = Math.max(8, 2 * R_top - 2 * 10);
  const holeD = Math.max(8, Math.min(rawHoleD, maxSafeHoleD));

  if (rawHoleD > maxSafeHoleD) {
    warnings.push({
      field: 'holeDiameter',
      message: `Furo da manilha limitado a Ø${holeD.toFixed(1)}mm para garantir espessura de parede segura (mín. 10mm).`,
      type: 'correction',
    });
  }

  // Top circular arc bulge: sweeps angle (PI - 2*alpha) CCW from TR to TL
  // Bulge = tan((PI - 2*alpha) / 4) = tan(PI/4 - alpha/2)
  const arcBulge = Math.tan(Math.PI / 4 - alphaRad / 2);

  // Base weld chamfer
  const rawChamfer = params.baseChamfer ?? 10;
  const bChamfer = Math.max(0, Math.min(rawChamfer, xBase / 3, deltaY / 3));

  const lugVertices: LWPolylineVertex[] = [];
  if (bChamfer > 0.5) {
    lugVertices.push(
      { x: -xBase + bChamfer, y: yBottom, bulge: 0 },
      { x: xBase - bChamfer, y: yBottom, bulge: 0 },
      { x: xBase, y: yBottom + bChamfer, bulge: 0 },
      { x: xTR, y: yTR, bulge: arcBulge },
      { x: xTL, y: yTL, bulge: 0 },
      { x: -xBase, y: yBottom + bChamfer, bulge: 0 }
    );
  } else {
    lugVertices.push(
      { x: -xBase, y: yBottom, bulge: 0 },
      { x: xBase, y: yBottom, bulge: 0 },
      { x: xTR, y: yTR, bulge: arcBulge },
      { x: xTL, y: yTL, bulge: 0 }
    );
  }

  outerPolylines.push({ vertices: lugVertices, isClosed: true, layer: 'CUT' });

  // Center Shackle Hole positioned at top arc center
  circles.push({
    type: 'circle',
    center: { x: 0, y: yTopCenter },
    radius: holeD / 2,
    layer: 'CUT',
  });

  const piercingCount = 2;

  // Technical Dimensions (ISO 129)
  cotas.push({
    type: 'linear',
    start: { x: -xBase, y: yBottom },
    end: { x: xBase, y: yBottom },
    label: `Base ${B.toFixed(1)} mm`,
    valueMm: B,
    orientation: 'horizontal',
    offset: 20,
  });
  cotas.push({
    type: 'linear',
    start: { x: xBase, y: yBottom },
    end: { x: xBase, y: H / 2 },
    label: `Altura ${H.toFixed(1)} mm`,
    valueMm: H,
    orientation: 'vertical',
    offset: 20,
  });
  cotas.push({
    type: 'linear',
    start: { x: -xBase - 15, y: yBottom },
    end: { x: -xBase - 15, y: yTopCenter },
    label: `Centro ${hCenterFromBase.toFixed(1)} mm`,
    valueMm: hCenterFromBase,
    orientation: 'vertical',
    offset: 15,
  });
  cotas.push({
    type: 'diameter',
    start: { x: -holeD / 2, y: yTopCenter },
    end: { x: holeD / 2, y: yTopCenter },
    label: `Ø${holeD.toFixed(1)} mm (Manilha)`,
    valueMm: holeD,
  });
  cotas.push({
    type: 'radius',
    start: { x: 0, y: yTopCenter },
    end: { x: 0, y: H / 2 },
    label: `R${R_top.toFixed(1)} mm`,
    valueMm: R_top,
  });

  return {
    outerPolylines,
    innerPolylines,
    circles,
    bendLines: [],
    cotas,
    warnings,
    errors,
    piercingCount,
    bendCount: 0,
    blankWidthMm,
    blankHeightMm,
  };
}
