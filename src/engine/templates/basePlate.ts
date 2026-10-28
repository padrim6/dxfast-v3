// DXFAST :: Solver PLACA DE BASE DE PILAR (base_plate)
// Placa retangular centrada na origem, 4 furos de chumbador posicionados por
// entre centros (gaugeX, gaugeY), furo central opcional. Compativel com fillet e
// chamfer (mutuamente exclusivos), igual o rectPlate. Furacao por entre centros:
// a distancia a borda e medida residual (cota de referencia), nunca parametro.
// Proibido o caractere traco-longo em qualquer string.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import { MIN_WALL_GAP, createRectangularContour } from '../helpers';
import { applyCenterHole } from '../features';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveBasePlate(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const W = Math.max(20, params.width || 300);
  const H = Math.max(20, params.height || 300);
  const holeDia = Math.max(1, params.holeDiameter || 22);
  const gaugeX = Math.max(1, params.gaugeX || 240);
  const gaugeY = Math.max(1, params.gaugeY || 240);
  const blankWidthMm = W;
  const blankHeightMm = H;

  // Cantos: fillet e chamfer mutuamente exclusivos (mesma logica do rectPlate).
  const filletEnabled = Boolean(features.fillet?.enabled);
  const rawFilletR = filletEnabled ? Number(features.fillet?.params?.radius || 0) : 0;
  const maxCornerR = Math.max(0, Math.min(W, H) / 2 - MIN_WALL_GAP);
  const filletR = Math.min(rawFilletR, maxCornerR);
  if (filletEnabled && rawFilletR > maxCornerR) {
    warnings.push({
      field: 'fillet',
      message: `Raio do canto ajustado para R${filletR.toFixed(1)}mm (limite geometrico de metade da chapa).`,
      type: 'correction',
    });
  }

  const chamferEnabled = Boolean(features.chamfer?.enabled);
  const rawChamferS = chamferEnabled && !filletEnabled ? Number(features.chamfer?.params?.size || 0) : 0;
  const chamferS = Math.min(rawChamferS, maxCornerR);
  if (filletEnabled && chamferEnabled) {
    warnings.push({
      field: 'chamfer',
      message: 'Cantos arredondados e chanfros sao mutuamente exclusivos. O arredondamento (fillet) foi aplicado.',
      type: 'warning',
    });
  }

  outerPolylines.push(createRectangularContour(W, H, filletR, chamferS));
  let piercingCount = 1; // contorno externo

  // Furos de chumbador (entre centros): posicoes (+/-gaugeX/2, +/-gaugeY/2).
  const hx = gaugeX / 2;
  const hy = gaugeY / 2;
  const anchors: { x: number; y: number; r: number }[] = [
    { x: hx, y: hy, r: holeDia / 2 },
    { x: -hx, y: hy, r: holeDia / 2 },
    { x: -hx, y: -hy, r: holeDia / 2 },
    { x: hx, y: -hy, r: holeDia / 2 },
  ];

  // Validacao honesta (holeGuard): parede ate a borda e entre furos do mesmo lado.
  const wallToEdgeX = (W - gaugeX) / 2 - holeDia / 2;
  const wallToEdgeY = (H - gaugeY) / 2 - holeDia / 2;
  if (wallToEdgeX < MIN_WALL_GAP) {
    errors.push({
      code: 'HOLE_OUTSIDE_CONTOUR',
      severity: 'error',
      message: `Os furos de chumbador ficam a ${wallToEdgeX.toFixed(1)}mm da borda em X, abaixo da parede minima de ${MIN_WALL_GAP}mm. Reduza o entre centros X ou o diametro, ou aumente o comprimento.`,
      field: 'gaugeX',
    });
  }
  if (wallToEdgeY < MIN_WALL_GAP) {
    errors.push({
      code: 'HOLE_OUTSIDE_CONTOUR',
      severity: 'error',
      message: `Os furos de chumbador ficam a ${wallToEdgeY.toFixed(1)}mm da borda em Y, abaixo da parede minima de ${MIN_WALL_GAP}mm. Reduza o entre centros Y ou o diametro, ou aumente a largura.`,
      field: 'gaugeY',
    });
  }
  if (gaugeX < holeDia + MIN_WALL_GAP) {
    errors.push({
      code: 'HOLE_COLLISION',
      severity: 'error',
      message: `O entre centros X (${gaugeX}mm) e menor que o diametro do furo mais a parede minima. Aumente o entre centros X.`,
      field: 'gaugeX',
    });
  }
  if (gaugeY < holeDia + MIN_WALL_GAP) {
    errors.push({
      code: 'HOLE_COLLISION',
      severity: 'error',
      message: `O entre centros Y (${gaugeY}mm) e menor que o diametro do furo mais a parede minima. Aumente o entre centros Y.`,
      field: 'gaugeY',
    });
  }

  anchors.forEach((a) => {
    circles.push({ type: 'circle', center: { x: a.x, y: a.y }, radius: a.r, layer: 'CUT' });
    piercingCount++;
  });

  // Furo central opcional (reaproveita a feature compartilhada).
  if (features.centerHole?.enabled) {
    const centerResult = applyCenterHole({
      rawDiameter: Number(features.centerHole.params.diameter || 0),
      maxBoundaryDiameter: Math.min(W, H) - 2 * MIN_WALL_GAP,
      cornerHoleCenters: anchors,
      slotCapsules: [],
    });
    if (centerResult.circle) {
      circles.push(centerResult.circle);
      piercingCount += centerResult.piercings;
      cotas.push(...centerResult.cotas);
    }
    warnings.push(...centerResult.warnings);
  }

  // Cotas principais: dimensoes externas.
  cotas.push({
    type: 'linear',
    start: { x: -W / 2, y: H / 2 },
    end: { x: W / 2, y: H / 2 },
    label: `${W} mm`,
    valueMm: W,
    orientation: 'horizontal',
    offset: 24,
  });
  cotas.push({
    type: 'linear',
    start: { x: W / 2, y: -H / 2 },
    end: { x: W / 2, y: H / 2 },
    label: `${H} mm`,
    valueMm: H,
    orientation: 'vertical',
    offset: 24,
  });

  // Cotas principais de furacao: entre centros X e Y.
  cotas.push({
    type: 'linear',
    start: { x: -hx, y: -hy },
    end: { x: hx, y: -hy },
    label: `Entre centros X ${gaugeX} mm`,
    valueMm: gaugeX,
    orientation: 'horizontal',
    offset: 12,
  });
  cotas.push({
    type: 'linear',
    start: { x: -hx, y: -hy },
    end: { x: -hx, y: hy },
    label: `Entre centros Y ${gaugeY} mm`,
    valueMm: gaugeY,
    orientation: 'vertical',
    offset: 12,
  });

  // Cotas de referencia (residual): distancia da borda ao centro do furo.
  const edgeX = (W - gaugeX) / 2;
  const edgeY = (H - gaugeY) / 2;
  cotas.push({
    type: 'linear',
    start: { x: W / 2, y: hy },
    end: { x: hx, y: hy },
    label: `borda X: ${edgeX.toFixed(1)} mm (ref)`,
    valueMm: edgeX,
    orientation: 'horizontal',
    offset: 10,
  });
  cotas.push({
    type: 'linear',
    start: { x: hx, y: H / 2 },
    end: { x: hx, y: hy },
    label: `borda Y: ${edgeY.toFixed(1)} mm (ref)`,
    valueMm: edgeY,
    orientation: 'vertical',
    offset: 10,
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
