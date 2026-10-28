import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  MIN_WALL_GAP,
  createRectangularContour,
  SlotCapsule,
} from '../helpers';
import {
  applySlottedHoles,
  applyCornerHoles,
  applyCenterHole,
  applyBoltCircle,
  applyGridHoles,
} from '../features';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveRectPlate(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const W = Math.max(20, params.width || 200);
  const H = Math.max(20, params.height || 150);
  const blankWidthMm = W;
  const blankHeightMm = H;

  const filletEnabled = Boolean(features.fillet?.enabled);
  const rawFilletR = filletEnabled ? Number(features.fillet?.params?.radius || 0) : 0;
  const maxFilletR = Math.max(0, Math.min(W, H) / 2 - MIN_WALL_GAP);
  const filletR = Math.min(rawFilletR, maxFilletR);

  if (filletEnabled && rawFilletR > maxFilletR) {
    warnings.push({
      field: 'fillet',
      message: `Raio do canto ajustado para R${filletR.toFixed(1)}mm (limite geométrico de metade da chapa).`,
      type: 'correction',
    });
  }

  const chamferEnabled = Boolean(features.chamfer?.enabled);
  const rawChamferS = chamferEnabled && !filletEnabled ? Number(features.chamfer?.params?.size || 0) : 0;
  const maxChamferS = Math.max(0, Math.min(W, H) / 2 - MIN_WALL_GAP);
  const chamferS = Math.min(rawChamferS, maxChamferS);

  if (filletEnabled && chamferEnabled) {
    warnings.push({
      field: 'chamfer',
      message: 'Cantos arredondados e chanfros são mutuamente exclusivos. Arredondamento (Fillet) foi aplicado.',
      type: 'warning',
    });
  }

  const outerContour = createRectangularContour(W, H, filletR, chamferS);
  outerPolylines.push(outerContour);

  let piercingCount = 1; // 1 for external contour

  let cornerHoleCenters: { x: number; y: number; r: number }[] = [];
  let slotCapsules: SlotCapsule[] = [];

  // A. Slotted Holes
  const isSlotted = Boolean(features.slottedHoles?.enabled);
  let slotPattern = 'corners';

  if (isSlotted) {
    const slottedResult = applySlottedHoles({
      plateWidth: W,
      plateHeight: H,
      filletR,
      chamferS,
      slotParams: features.slottedHoles?.params || {},
      fallbackParams: params,
    });

    innerPolylines.push(...slottedResult.polylines);
    slotCapsules = slottedResult.capsules;
    piercingCount += slottedResult.piercings;
    cotas.push(...slottedResult.cotas);
    warnings.push(...slottedResult.warnings);
    slotPattern = slottedResult.pattern;
  }

  // B. Corner Holes
  if (features.cornerHoles?.enabled) {
    const cornerResult = applyCornerHoles({
      plateWidth: W,
      plateHeight: H,
      filletR,
      cornerHolesParams: features.cornerHoles.params || {},
      isSlotted,
      slotPattern,
      slotCapsules,
    });

    circles.push(...cornerResult.circles);
    cornerHoleCenters = cornerResult.holeCenters;
    piercingCount += cornerResult.piercings;
    cotas.push(...cornerResult.cotas);
    warnings.push(...cornerResult.warnings);
  }

  // C. Center Hole
  let centerHoleR = 0;
  if (features.centerHole?.enabled) {
    const centerResult = applyCenterHole({
      rawDiameter: Number(features.centerHole.params.diameter || 0),
      maxBoundaryDiameter: Math.min(W, H) - 2 * MIN_WALL_GAP,
      cornerHoleCenters,
      slotCapsules,
      boltCircleParams: features.boltCircle?.enabled
        ? {
            bcd: Number(features.boltCircle.params.bcd || 120),
            diameter: Number(features.boltCircle.params.diameter || 12),
            enabled: true,
          }
        : undefined,
    });

    if (centerResult.circle) {
      circles.push(centerResult.circle);
      centerHoleR = centerResult.centerHoleDia / 2;
    }
    piercingCount += centerResult.piercings;
    cotas.push(...centerResult.cotas);
    warnings.push(...centerResult.warnings);
  }

  // D. Bolt Circle
  let boltHoles: { x: number; y: number; r: number }[] = [];
  if (features.boltCircle?.enabled) {
    const boltResult = applyBoltCircle({
      plateWidth: W,
      plateHeight: H,
      bcdParams: features.boltCircle.params || {},
      centerHoleR,
      cornerHoleCenters,
      slotCapsules,
    });

    circles.push(...boltResult.circles);
    boltHoles = boltResult.boltHoles;
    piercingCount += boltResult.piercings;
    cotas.push(...boltResult.cotas);
    warnings.push(...boltResult.warnings);
  }

  // E. Grid Holes
  if (features.gridHoles?.enabled) {
    const gridResult = applyGridHoles({
      plateWidth: W,
      plateHeight: H,
      gridParams: features.gridHoles.params || {},
      filletR,
      centerHoleR,
      cornerHoleCenters,
      slotCapsules,
      boltHoles,
    });

    circles.push(...gridResult.circles);
    piercingCount += gridResult.piercings;
    cotas.push(...gridResult.cotas);
    warnings.push(...gridResult.warnings);
  }

  // Dimension Cotas Principais
  cotas.push({
    type: 'linear',
    start: { x: -W / 2, y: H / 2 },
    end: { x: W / 2, y: H / 2 },
    label: `${W} mm`,
    valueMm: W,
    orientation: 'horizontal',
    offset: 20,
  });
  cotas.push({
    type: 'linear',
    start: { x: W / 2, y: -H / 2 },
    end: { x: W / 2, y: H / 2 },
    label: `${H} mm`,
    valueMm: H,
    orientation: 'vertical',
    offset: 20,
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
