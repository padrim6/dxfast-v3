import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  MIN_WALL_GAP,
  BULGE_180_CCW,
} from '../helpers';
import {
  LWPolyline,
  LWPolylineVertex,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveOvalFlange(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const CC = Math.max(20, params.centerDistance || 130);
  const R = Math.max(10, params.endRadius || 35);
  const rawBoltD = params.boltHoleDia ?? 14;
  const boltD = Math.max(2, Math.min(rawBoltD, 2 * R - 2 * MIN_WALL_GAP));

  // Center Hole is strictly driven by features.centerHole
  const isCenterHoleEnabled = features.centerHole?.enabled ?? false;
  const rawID = isCenterHoleEnabled ? Number(features.centerHole?.params.diameter ?? 50) : 0;
  const maxID = Math.max(0, Math.min(2 * R - 2 * MIN_WALL_GAP, CC - boltD - 2 * MIN_WALL_GAP));
  const centerHoleDia = isCenterHoleEnabled ? Math.min(rawID, maxID) : 0;

  if (isCenterHoleEnabled && rawID > maxID && maxID > 2) {
    warnings.push({
      field: 'centerHole',
      message: `Furo central ajustado para Ø${centerHoleDia.toFixed(1)}mm para manter distância mínima (${MIN_WALL_GAP}mm) das arestas e dos furos de fixação.`,
      type: 'correction',
    });
  }

  const totalL = CC + 2 * R;
  const totalW = 2 * R;
  const blankWidthMm = totalL;
  const blankHeightMm = totalW;

  const halfCC = CC / 2;

  const ovalVertices: LWPolylineVertex[] = [
    { x: -halfCC, y: -R, bulge: 0 },
    { x: halfCC, y: -R, bulge: BULGE_180_CCW },
    { x: halfCC, y: R, bulge: 0 },
    { x: -halfCC, y: R, bulge: BULGE_180_CCW },
  ];

  outerPolylines.push({ vertices: ovalVertices, isClosed: true, layer: 'CUT' });

  let piercingCount = 1;

  // Optional Center Hole (only when enabled)
  if (isCenterHoleEnabled && centerHoleDia > 2) {
    circles.push({ type: 'circle', center: { x: 0, y: 0 }, radius: centerHoleDia / 2, layer: 'CUT' });
    piercingCount++;
  }

  // 2x Bolt Holes at (+- CC/2, 0)
  if (boltD > 1) {
    circles.push({ type: 'circle', center: { x: -halfCC, y: 0 }, radius: boltD / 2, layer: 'CUT' });
    circles.push({ type: 'circle', center: { x: halfCC, y: 0 }, radius: boltD / 2, layer: 'CUT' });
    piercingCount += 2;
  }

  // Technical Dimensions (ISO 129 / NBR ISO 2768)
  cotas.push({
    type: 'linear',
    start: { x: -halfCC, y: -R - 12 },
    end: { x: halfCC, y: -R - 12 },
    label: `C-C ${CC.toFixed(1)} mm`,
    valueMm: CC,
    orientation: 'horizontal',
  });

  cotas.push({
    type: 'linear',
    start: { x: -halfCC - R, y: R + 12 },
    end: { x: halfCC + R, y: R + 12 },
    label: `L ${totalL.toFixed(1)} mm`,
    valueMm: totalL,
    orientation: 'horizontal',
  });

  cotas.push({
    type: 'linear',
    start: { x: halfCC + R + 12, y: -R },
    end: { x: halfCC + R + 12, y: R },
    label: `W ${totalW.toFixed(1)} mm (2× R${R.toFixed(1)})`,
    valueMm: totalW,
    orientation: 'vertical',
  });

  if (boltD > 1) {
    cotas.push({
      type: 'diameter',
      start: { x: halfCC, y: -boltD / 2 },
      end: { x: halfCC, y: boltD / 2 },
      label: `2× Furos Ø${boltD.toFixed(1)} mm`,
      valueMm: boltD,
      offset: Math.max(12, R + 22 - boltD / 2),
    });
  }

  if (isCenterHoleEnabled && centerHoleDia > 2) {
    cotas.push({
      type: 'diameter',
      start: { x: 0, y: centerHoleDia / 2 },
      end: { x: 0, y: -centerHoleDia / 2 },
      label: `Furo Central Ø${centerHoleDia.toFixed(1)} mm`,
      valueMm: centerHoleDia,
      offset: Math.max(12, R + 22 - centerHoleDia / 2),
    });
  }

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
