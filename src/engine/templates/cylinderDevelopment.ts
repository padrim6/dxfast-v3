// DXFAST :: Solver VIROLA (desenvolvimento de cilindro) (cylinder_development)
// Planifica a chapa de um cilindro: o blank e um retangulo de largura igual ao
// perimetro (pi x diametro) mais a folga de solda, por altura. Depois o usuario
// rola e solda. Recorte 2D plano. Proibido o caractere traco-longo.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import { createRectangularContour } from '../helpers';
import { DimensionCota, SanitizationWarning, GeometryIssue } from '../../types/cad';

export function solveCylinderDevelopment(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const cotas: DimensionCota[] = [];

  const D = Math.max(10, params.diameter || 300);
  const H = Math.max(10, params.height || 500);
  const weldGap = Math.max(0, params.weldGap || 0);

  const developed = Math.PI * D + weldGap;
  const blankWidthMm = developed;
  const blankHeightMm = H;

  const outer = createRectangularContour(developed, H, 0, 0);

  cotas.push({
    type: 'linear', start: { x: -developed / 2, y: H / 2 }, end: { x: developed / 2, y: H / 2 },
    label: `${developed.toFixed(1)} mm (pi x ${D}${weldGap > 0 ? ` + ${weldGap}` : ''})`,
    valueMm: developed, orientation: 'horizontal', offset: 25,
  });
  cotas.push({
    type: 'linear', start: { x: developed / 2, y: -H / 2 }, end: { x: developed / 2, y: H / 2 },
    label: `${H} mm`, valueMm: H, orientation: 'vertical', offset: 25,
  });

  return {
    outerPolylines: [outer],
    innerPolylines: [],
    circles: [],
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
