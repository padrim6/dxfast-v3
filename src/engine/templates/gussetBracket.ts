// DXFAST :: Solver MAO FRANCESA (gusset_bracket)
// Triangulo retangulo plano: angulo reto na origem, braco horizontal (base) ao
// longo de +X ate (baseLength,0), braco vertical (montante) ao longo de +Y ate
// (0,height), unidos pela hipotenusa. Alivio de canto opcional (chanfro 45 graus
// no vertice reto). Furacao em duas fileiras, posicionada por entre centros a
// partir do canto reto (datum). Proibido o caractere traco-longo.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import { MIN_WALL_GAP } from '../helpers';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveGussetBracket(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const L = Math.max(20, params.baseLength || 200);
  const H = Math.max(20, params.height || 200);
  const holeDia = Math.max(1, params.holeDiameter || 10);
  const relief = Math.max(0, params.cornerRelief || 0);
  const baseCount = Math.max(0, Math.round(params.baseHoleCount ?? 2));
  const basePitch = Math.max(0, params.basePitch || 80);
  const baseGauge = Math.max(0, params.baseGauge || 25);
  const baseStart = Math.max(0, params.baseStartOffset || 50);
  const upCount = Math.max(0, Math.round(params.uprightHoleCount ?? 2));
  const upPitch = Math.max(0, params.uprightPitch || 80);
  const upGauge = Math.max(0, params.uprightGauge || 25);
  const upStart = Math.max(0, params.uprightStartOffset || 50);

  const blankWidthMm = L;
  const blankHeightMm = H;

  // Contorno triangular (com alivio de canto quando relief > 0).
  const maxRelief = Math.max(0, Math.min(L, H) / 2 - MIN_WALL_GAP);
  const effRelief = Math.min(relief, maxRelief);
  if (relief > maxRelief + 1e-6) {
    warnings.push({
      field: 'cornerRelief',
      message: `Alivio de canto ajustado para ${effRelief.toFixed(1)}mm (limite geometrico do triangulo).`,
      type: 'correction',
    });
  }

  const verts: { x: number; y: number }[] = [];
  if (effRelief > 0.05) {
    verts.push({ x: effRelief, y: 0 });
    verts.push({ x: L, y: 0 });
    verts.push({ x: 0, y: H });
    verts.push({ x: 0, y: effRelief });
  } else {
    verts.push({ x: 0, y: 0 });
    verts.push({ x: L, y: 0 });
    verts.push({ x: 0, y: H });
  }
  outerPolylines.push({
    vertices: verts.map((v) => ({ x: v.x, y: v.y })),
    isClosed: true,
    layer: 'CUT',
  });

  let piercingCount = 1;

  // Furos: fileira da base e fileira do montante.
  const baseHoles: { x: number; y: number }[] = [];
  for (let k = 0; k < baseCount; k++) baseHoles.push({ x: baseStart + k * basePitch, y: baseGauge });
  const upHoles: { x: number; y: number }[] = [];
  for (let k = 0; k < upCount; k++) upHoles.push({ x: upGauge, y: upStart + k * upPitch });

  // Validacao honesta (holeGuard) contra as tres (ou quatro) bordas.
  const hypDenom = Math.hypot(1 / L, 1 / H);
  const checkHole = (c: { x: number; y: number }, fieldBase: string) => {
    const req = holeDia / 2 + MIN_WALL_GAP;
    // borda inferior (y = 0)
    if (c.y - holeDia / 2 < MIN_WALL_GAP) {
      errors.push({
        code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: `${fieldBase}Gauge`,
        message: `Um furo da fileira ${fieldBase === 'base' ? 'da base' : 'do montante'} fica a menos de ${MIN_WALL_GAP}mm da borda inferior. Ajuste o gauge.`,
      });
      return;
    }
    // borda esquerda (x = 0)
    if (c.x - holeDia / 2 < MIN_WALL_GAP) {
      errors.push({
        code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: `${fieldBase}Gauge`,
        message: `Um furo da fileira ${fieldBase === 'base' ? 'da base' : 'do montante'} fica a menos de ${MIN_WALL_GAP}mm da borda esquerda. Ajuste o gauge.`,
      });
      return;
    }
    // hipotenusa x/L + y/H = 1
    const signed = c.x / L + c.y / H - 1;
    const distHyp = Math.abs(signed) / hypDenom;
    if (signed > -1e-9 || distHyp < req) {
      errors.push({
        code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: `${fieldBase}StartOffset`,
        message: `Um furo da fileira ${fieldBase === 'base' ? 'da base' : 'do montante'} invade a folga da hipotenusa (necessario ${req.toFixed(1)}mm). Reduza o deslocamento, a quantidade ou o entre centros.`,
      });
      return;
    }
    // borda do alivio (x + y = relief)
    if (effRelief > 0.05) {
      const distRelief = (c.x + c.y - effRelief) / Math.SQRT2;
      if (distRelief < req) {
        errors.push({
          code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: 'cornerRelief',
          message: `Um furo fica perto demais do alivio de canto (necessario ${req.toFixed(1)}mm). Reduza o alivio ou afaste a furacao.`,
        });
      }
    }
  };

  baseHoles.forEach((c) => {
    checkHole(c, 'base');
    circles.push({ type: 'circle', center: { x: c.x, y: c.y }, radius: holeDia / 2, layer: 'CUT' });
    piercingCount++;
  });
  upHoles.forEach((c) => {
    checkHole(c, 'upright');
    circles.push({ type: 'circle', center: { x: c.x, y: c.y }, radius: holeDia / 2, layer: 'CUT' });
    piercingCount++;
  });

  // Cotas externas.
  cotas.push({
    type: 'linear', start: { x: 0, y: 0 }, end: { x: L, y: 0 },
    label: `${L} mm`, valueMm: L, orientation: 'horizontal', offset: -22,
  });
  cotas.push({
    type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: H },
    label: `${H} mm`, valueMm: H, orientation: 'vertical', offset: -22,
  });

  // Cotas de entre centros (principais) quando a fileira tem 2 ou mais furos.
  if (baseCount >= 2) {
    cotas.push({
      type: 'linear', start: { x: baseStart, y: baseGauge }, end: { x: baseStart + basePitch, y: baseGauge },
      label: `Pitch base ${basePitch} mm`, valueMm: basePitch, orientation: 'horizontal', offset: 12,
    });
  }
  if (upCount >= 2) {
    cotas.push({
      type: 'linear', start: { x: upGauge, y: upStart }, end: { x: upGauge, y: upStart + upPitch },
      label: `Pitch montante ${upPitch} mm`, valueMm: upPitch, orientation: 'vertical', offset: 12,
    });
  }

  // Referencia: deslocamento do primeiro furo a partir do canto.
  if (baseCount >= 1) {
    cotas.push({
      type: 'linear', start: { x: 0, y: baseGauge }, end: { x: baseStart, y: baseGauge },
      label: `offset base: ${baseStart.toFixed(0)} mm (ref)`, valueMm: baseStart, orientation: 'horizontal', offset: 8,
    });
  }
  if (upCount >= 1) {
    cotas.push({
      type: 'linear', start: { x: upGauge, y: 0 }, end: { x: upGauge, y: upStart },
      label: `offset montante: ${upStart.toFixed(0)} mm (ref)`, valueMm: upStart, orientation: 'vertical', offset: 8,
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
