// DXFAST :: Solver CHAPA TRAPEZOIDAL (trapezoid_plate)
// Trapezio isosceles centrado na origem: base maior embaixo, base menor em cima.
// Recorte 2D plano, sem dobra. Proibido o caractere traco-longo.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveTrapezoidPlate(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const cotas: DimensionCota[] = [];
  const circles: CircleElement[] = [];

  const bW = Math.max(2, params.bottomWidth || 300);
  const tW = Math.max(2, params.topWidth || 180);
  const H = Math.max(2, params.height || 200);

  const blankWidthMm = Math.max(bW, tW);
  const blankHeightMm = H;

  const outer: LWPolyline = {
    vertices: [
      { x: -bW / 2, y: -H / 2 },
      { x: bW / 2, y: -H / 2 },
      { x: tW / 2, y: H / 2 },
      { x: -tW / 2, y: H / 2 },
    ],
    isClosed: true,
    layer: 'CUT',
  };

  // Cotas: bases e altura.
  cotas.push({ type: 'linear', start: { x: -bW / 2, y: -H / 2 }, end: { x: bW / 2, y: -H / 2 }, label: `${bW} mm`, valueMm: bW, orientation: 'horizontal', offset: -24 });
  cotas.push({ type: 'linear', start: { x: -tW / 2, y: H / 2 }, end: { x: tW / 2, y: H / 2 }, label: `${tW} mm`, valueMm: tW, orientation: 'horizontal', offset: 24 });
  cotas.push({ type: 'linear', start: { x: -blankWidthMm / 2, y: -H / 2 }, end: { x: -blankWidthMm / 2, y: H / 2 }, label: `${H} mm`, valueMm: H, orientation: 'vertical', offset: -24 });

  return {
    outerPolylines: [outer],
    innerPolylines: [],
    circles,
    bendLines: [],
    cotas,
    warnings,
    errors,
    piercingCount: 1,
    bendCount: 0,
    blankWidthMm,
    blankHeightMm,
  };
}
