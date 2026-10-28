// DXFAST :: Solver ESTRELA / POLIGONO ESTRELADO (star_polygon)
// Estrela de N pontas: vertices alternando entre o raio externo (pontas) e o raio
// interno (vales), ao redor do centro. Furo central opcional. Recorte 2D plano.
// Proibido o caractere traco-longo em qualquer string.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import { MIN_WALL_GAP } from '../helpers';
import { applyCenterHole } from '../features';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveStarPolygon(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const circles: CircleElement[] = [];
  const innerPolylines: LWPolyline[] = [];
  const cotas: DimensionCota[] = [];

  const points = Math.max(3, Math.min(24, Math.round(params.points || 5)));
  const outerR = Math.max(10, params.outerRadius || 100);
  let innerR = Math.max(3, params.innerRadius || 45);
  if (innerR > outerR - 2) {
    innerR = Math.max(3, outerR - 2);
    warnings.push({ field: 'innerRadius', message: `Raio interno limitado a ${innerR.toFixed(1)}mm para ficar menor que o externo.`, type: 'correction' });
  }

  const blankWidthMm = 2 * outerR;
  const blankHeightMm = 2 * outerR;

  // Vertices alternados comecando numa ponta no topo.
  const verts: { x: number; y: number }[] = [];
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const ang = -Math.PI / 2 + (i * Math.PI) / points;
    verts.push({ x: r * Math.cos(ang), y: r * Math.sin(ang) });
  }
  const outer: LWPolyline = { vertices: verts, isClosed: true, layer: 'CUT' };

  let piercingCount = 1;

  // Furo central opcional, limitado pelo raio interno (cabe no corpo da estrela).
  if (features.centerHole?.enabled) {
    const maxDia = Math.max(0, 2 * innerR - 2 * MIN_WALL_GAP);
    const centerResult = applyCenterHole({
      rawDiameter: Number(features.centerHole.params.diameter || 0),
      maxBoundaryDiameter: maxDia,
      cornerHoleCenters: [],
      slotCapsules: [],
    });
    if (centerResult.circle) {
      circles.push(centerResult.circle);
      piercingCount += centerResult.piercings;
      cotas.push(...centerResult.cotas);
    }
    warnings.push(...centerResult.warnings);
  }

  // Cotas: diametros externo e interno.
  cotas.push({ type: 'diameter', start: { x: 0, y: -outerR }, end: { x: 0, y: outerR }, label: `Ø${(2 * outerR).toFixed(0)} mm (externo)`, valueMm: 2 * outerR, offset: 16 });
  cotas.push({ type: 'diameter', start: { x: -innerR, y: 0 }, end: { x: innerR, y: 0 }, label: `Ø${(2 * innerR).toFixed(0)} mm (interno)`, valueMm: 2 * innerR, offset: 12 });

  return {
    outerPolylines: [outer],
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
