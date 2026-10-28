import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import { MIN_WALL_GAP } from '../helpers';
import {
  LWPolyline,
  LWPolylineVertex,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solvePolygonRegular(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const N = Math.max(3, Math.min(24, Math.round(params.sidesCount || 6)));
  const OD = Math.max(20, params.outerDiameter || 180);
  const startAngleDeg = params.startAngle || 0;
  const startAngleRad = (startAngleDeg * Math.PI) / 180;
  const R = OD / 2;

  // Apothem / Inradius (distance from center to flat face midpoint)
  const rIn = R * Math.cos(Math.PI / N);
  const acrossFlats = 2 * rIn; // Distance between opposite flats (for even N)
  const sideLenFull = 2 * R * Math.sin(Math.PI / N);
  const beta = ((N - 2) * Math.PI) / N; // Interior angle between adjacent sides

  // 1. Center Hole Feature
  const isCenterHoleEnabled = features.centerHole?.enabled ?? false;
  const rawCenterHoleDia = isCenterHoleEnabled ? Number(features.centerHole?.params.diameter ?? 40) : 0;
  const maxSafeHoleDia = Math.max(0, 2 * rIn - 2 * MIN_WALL_GAP);
  const centerHoleDia = Math.min(rawCenterHoleDia, maxSafeHoleDia);

  if (isCenterHoleEnabled && rawCenterHoleDia > maxSafeHoleDia && maxSafeHoleDia > 2) {
    warnings.push({
      field: 'centerHole',
      message: `Furo central ajustado para Ø${centerHoleDia.toFixed(1)}mm para garantir parede mínima (${MIN_WALL_GAP}mm) até as faces do polígono.`,
      type: 'correction',
    });
  }

  // 2. Corner Fillet Feature
  const isFilletEnabled = features.fillet?.enabled ?? false;
  const rawFilletRadius = isFilletEnabled ? Number(features.fillet?.params.radius ?? 8) : 0;
  const maxFilletRadius = (sideLenFull / 2) * Math.tan(beta / 2) * 0.95;
  const filletR = Math.max(0, Math.min(rawFilletRadius, maxFilletRadius));

  if (isFilletEnabled && rawFilletRadius > maxFilletRadius && maxFilletRadius > 0.5) {
    warnings.push({
      field: 'fillet',
      message: `Raio dos cantos limitado a R${filletR.toFixed(1)}mm para evitar sobreposição das arestas adjacentes.`,
      type: 'correction',
    });
  }

  const blankWidthMm = OD;
  const blankHeightMm = OD;

  const polyVertices: LWPolylineVertex[] = [];
  const stepRad = (2 * Math.PI) / N;

  if (filletR > 0.5) {
    // Rounded regular polygon with bulged corner vertices
    const tEdge = filletR / Math.tan(beta / 2);
    const theta = (2 * Math.PI) / N; // Corner turn angle
    const cornerBulge = Math.tan(theta / 4);

    for (let i = 0; i < N; i++) {
      const angCurr = startAngleRad + i * stepRad;
      const angPrev = startAngleRad + (i - 1 + N) * stepRad;
      const angNext = startAngleRad + ((i + 1) % N) * stepRad;

      const vx = R * Math.cos(angCurr);
      const vy = R * Math.sin(angCurr);

      const vPrevX = R * Math.cos(angPrev);
      const vPrevY = R * Math.sin(angPrev);

      const vNextX = R * Math.cos(angNext);
      const vNextY = R * Math.sin(angNext);

      const dPrev = Math.hypot(vPrevX - vx, vPrevY - vy);
      const dNext = Math.hypot(vNextX - vx, vNextY - vy);

      const pInX = vx + (tEdge / dPrev) * (vPrevX - vx);
      const pInY = vy + (tEdge / dPrev) * (vPrevY - vy);

      const pOutX = vx + (tEdge / dNext) * (vNextX - vx);
      const pOutY = vy + (tEdge / dNext) * (vNextY - vy);

      polyVertices.push({ x: pInX, y: pInY, bulge: cornerBulge });
      polyVertices.push({ x: pOutX, y: pOutY, bulge: 0 });
    }
  } else {
    for (let i = 0; i < N; i++) {
      const angle = startAngleRad + i * stepRad;
      polyVertices.push({
        x: R * Math.cos(angle),
        y: R * Math.sin(angle),
        bulge: 0,
      });
    }
  }

  outerPolylines.push({ vertices: polyVertices, isClosed: true, layer: 'CUT' });
  let piercingCount = 1;

  // 3. Center Hole Hole Generation
  if (isCenterHoleEnabled && centerHoleDia > 2) {
    circles.push({ type: 'circle', center: { x: 0, y: 0 }, radius: centerHoleDia / 2, layer: 'CUT' });
    piercingCount++;
  }

  // 4. Bolt Circle (BCD) Feature
  if (features.boltCircle?.enabled) {
    const bcd = Number(features.boltCircle.params.bcd ?? 120);
    const holeCount = Math.max(1, Math.min(24, Math.round(Number(features.boltCircle.params.count ?? N))));
    const holeDia = Number(features.boltCircle.params.diameter ?? 10);

    const maxSafeBcd = 2 * rIn - holeDia - 2 * MIN_WALL_GAP;
    const minSafeBcd =
      (isCenterHoleEnabled && centerHoleDia > 0 ? centerHoleDia : 0) + holeDia + 2 * MIN_WALL_GAP;

    const safeBcd = Math.max(10, Math.min(bcd, maxSafeBcd));
    const safeHoleDia = Math.max(2, Math.min(holeDia, 50));

    if (safeBcd > minSafeBcd) {
      const bcdStep = (2 * Math.PI) / holeCount;
      for (let i = 0; i < holeCount; i++) {
        const bcdAngle = startAngleRad + i * bcdStep;
        const hx = (safeBcd / 2) * Math.cos(bcdAngle);
        const hy = (safeBcd / 2) * Math.sin(bcdAngle);
        circles.push({
          type: 'circle',
          center: { x: hx, y: hy },
          radius: safeHoleDia / 2,
          layer: 'CUT',
        });
        piercingCount++;
      }

      {
        // BCD: cota concêntrica roteada para baixo-esquerda, rótulo fora do OD,
        // para não empilhar com OD/Entre-Faces (que são direcionais).
        const a = (-140 * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        cotas.push({
          type: 'diameter',
          start: { x: -(safeBcd / 2) * ca, y: -(safeBcd / 2) * sa },
          end: { x: (safeBcd / 2) * ca, y: (safeBcd / 2) * sa },
          label: `Ø${safeBcd.toFixed(1)} BCD (${holeCount}× Ø${safeHoleDia.toFixed(1)})`,
          valueMm: safeBcd,
          offset: Math.max(12, R + 26 - safeBcd / 2),
        });
      }
    }
  }

  // Primary Technical Dimensions
  const polygonNames: Record<number, string> = {
    3: 'Triângulo',
    4: 'Quadrado',
    5: 'Pentágono',
    6: 'Hexágono',
    7: 'Heptágono',
    8: 'Octógono',
    9: 'Eneágono',
    10: 'Decágono',
    12: 'Dodecágono',
  };
  const polyTypeName = polygonNames[N] || `Polígono ${N} Lados`;

  cotas.push({
    type: 'diameter',
    start: { x: -R * Math.cos(startAngleRad), y: -R * Math.sin(startAngleRad) },
    end: { x: R * Math.cos(startAngleRad), y: R * Math.sin(startAngleRad) },
    label: `${polyTypeName} • Ø${OD.toFixed(1)} mm (OD)`,
    valueMm: OD,
  });

  cotas.push({
    type: 'linear',
    start: { x: -rIn * Math.sin(startAngleRad), y: rIn * Math.cos(startAngleRad) },
    end: { x: rIn * Math.sin(startAngleRad), y: -rIn * Math.cos(startAngleRad) },
    label: `Entre Faces: ${acrossFlats.toFixed(1)} mm`,
    valueMm: acrossFlats,
  });

  if (isCenterHoleEnabled && centerHoleDia > 2) {
    // Furo central: cota roteada para baixo, rótulo fora do OD.
    const a = (-90 * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    cotas.push({
      type: 'diameter',
      start: { x: -(centerHoleDia / 2) * ca, y: -(centerHoleDia / 2) * sa },
      end: { x: (centerHoleDia / 2) * ca, y: (centerHoleDia / 2) * sa },
      label: `Furo Central Ø${centerHoleDia.toFixed(1)} mm`,
      valueMm: centerHoleDia,
      offset: Math.max(12, R + 24 - centerHoleDia / 2),
    });
  }

  if (isFilletEnabled && filletR > 0.5) {
    cotas.push({
      type: 'radius',
      start: { x: 0, y: 0 },
      end: { x: R, y: 0 },
      label: `${N}× Cantos R${filletR.toFixed(1)} mm`,
      valueMm: filletR,
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
