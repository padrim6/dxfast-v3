import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  MIN_WALL_GAP,
  BULGE_180_CCW,
} from '../helpers';
import { createKeywayContour } from '../features/keyway';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveCircleFlange(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];

  const rawOD = params.outerDiameter ?? 200;
  const OD = Math.max(20, rawOD);
  const blankWidthMm = OD;
  const blankHeightMm = OD;
  const R_out = OD / 2;

  // 1. Contorno externo contínuo com arcos de 180 graus (bulge = 1.0)
  outerPolylines.push({
    vertices: [
      { x: -R_out, y: 0, bulge: BULGE_180_CCW },
      { x: R_out, y: 0, bulge: BULGE_180_CCW },
    ],
    isClosed: true,
    layer: 'CUT',
  });

  let piercingCount = 1;

  // 2. Furação Circular / Polar BCD
  const isBcdEnabled =
    features.boltCircle?.enabled === true ||
    (features.boltCircle === undefined &&
      params.holeCount !== undefined &&
      params.holeCount > 0 &&
      params.bcdDiameter !== undefined &&
      params.bcdDiameter > 0);

  let BCD = 0;
  let holeCount = 0;
  let holeDia = 0;
  let startAng = 0;

  if (isBcdEnabled) {
    const rawCount =
      features.boltCircle?.params?.count !== undefined
        ? Number(features.boltCircle.params.count)
        : (params.holeCount ?? 4);
    holeCount = Math.max(1, Math.min(48, Math.round(rawCount)));

    const rawHoleDia =
      features.boltCircle?.params?.diameter !== undefined
        ? Number(features.boltCircle.params.diameter)
        : (params.holeDiameter ?? 14);

    const rawBCD =
      features.boltCircle?.params?.bcd !== undefined
        ? Number(features.boltCircle.params.bcd)
        : (params.bcdDiameter ?? 150);

    startAng =
      features.boltCircle?.params?.startAngle !== undefined
        ? Number(features.boltCircle.params.startAngle)
        : (params.startAngle ?? 45);

    // Limites de segurança física
    const maxHoleDiaAllowed = Math.max(2, (OD - 4 * MIN_WALL_GAP) / 2);
    holeDia = Math.min(rawHoleDia, maxHoleDiaAllowed);

    const minBCD_Absolute = 20;
    const maxBCD_Absolute = Math.max(minBCD_Absolute, OD - holeDia - 2 * MIN_WALL_GAP);
    BCD = Math.max(minBCD_Absolute, Math.min(maxBCD_Absolute, rawBCD));

    // Verificação analítica de corda polar entre furos adjacentes
    if (holeCount > 1) {
      const chord = BCD * Math.sin(Math.PI / holeCount);
      const maxDiaChord = chord - MIN_WALL_GAP;
      if (holeDia > maxDiaChord && maxDiaChord >= 2) {
        holeDia = Math.max(2, Math.floor(maxDiaChord * 10) / 10);
        warnings.push({
          field: 'boltCircle.diameter',
          message: `Diâmetro dos furos BCD ajustado para Ø${holeDia.toFixed(1)}mm para evitar sobreposição entre os ${holeCount} furos.`,
          type: 'correction',
        });
      }
    }

    if (rawBCD > maxBCD_Absolute) {
      warnings.push({
        field: 'boltCircle.bcd',
        message: `Diâmetro BCD ajustado para Ø${BCD.toFixed(1)}mm para manter os furos dentro da flange (parede segura de ${MIN_WALL_GAP}mm).`,
        type: 'correction',
      });
    }
  }

  // 3. Furo Central e Rasgo de Chaveta DIN 6885
  const isKeywayEnabled =
    features.keyway?.enabled === true ||
    (params.keyWidth !== undefined &&
      params.keyWidth > 0 &&
      params.keyDepth !== undefined &&
      params.keyDepth > 0);

  const isCenterHoleEnabled =
    features.centerHole?.enabled === true ||
    (features.centerHole === undefined &&
      (params.centerHoleDia !== undefined ||
        params.innerDiameter !== undefined ||
        params.centerDiameter !== undefined)) ||
    isKeywayEnabled;

  let rawID = 0;
  if (isCenterHoleEnabled) {
    if (features.centerHole?.params?.diameter !== undefined) {
      rawID = Number(features.centerHole.params.diameter);
    } else if (params.centerHoleDia !== undefined) {
      rawID = params.centerHoleDia;
    } else if (params.innerDiameter !== undefined) {
      rawID = params.innerDiameter;
    } else if (params.centerDiameter !== undefined) {
      rawID = params.centerDiameter;
    } else if (isKeywayEnabled) {
      rawID = 40;
    }
  }

  if (isKeywayEnabled && rawID < 10) {
    rawID = 40; // Diâmetro padrão de eixo para chaveta
  }

  const maxID_WithBCD = isBcdEnabled
    ? BCD - holeDia - 2 * MIN_WALL_GAP
    : OD - 2 * MIN_WALL_GAP;
  const maxID_Absolute = Math.max(0, Math.min(OD - 2 * MIN_WALL_GAP, maxID_WithBCD));
  const ID = isCenterHoleEnabled ? Math.max(0, Math.min(maxID_Absolute, rawID)) : 0;

  if (isCenterHoleEnabled && rawID > maxID_Absolute && maxID_Absolute > 0) {
    warnings.push({
      field: 'centerHole.diameter',
      message: `Furo central limitado a Ø${ID.toFixed(1)}mm para respeitar as paredes de segurança (${MIN_WALL_GAP}mm) e a furação BCD.`,
      type: 'correction',
    });
  }

  let keyB = 0;
  const rShaft = ID / 2;

  if (isKeywayEnabled && ID > 2) {
    const rawKeyB =
      features.keyway?.params?.width !== undefined
        ? Number(features.keyway.params.width)
        : (params.keyWidth ?? 10);

    const rawKeyT2 =
      features.keyway?.params?.depth !== undefined
        ? Number(features.keyway.params.depth)
        : (params.keyDepth ?? 3.3);

    const maxKeyB = Math.max(2, ID * 0.85);
    keyB = Math.min(rawKeyB, maxKeyB);

    const maxKeyT2 = isBcdEnabled
      ? Math.max(1, (BCD - holeDia) / 2 - rShaft - MIN_WALL_GAP)
      : Math.max(1, R_out - rShaft - MIN_WALL_GAP);
    const keyT2 = Math.min(rawKeyT2, maxKeyT2);

    const kwResult = createKeywayContour(ID, keyB, keyT2);
    innerPolylines.push(kwResult.polyline);
    piercingCount++;
    cotas.push(...kwResult.cotas);
  } else if (ID > 2) {
    circles.push({ type: 'circle', center: { x: 0, y: 0 }, radius: ID / 2, layer: 'CUT' });
    piercingCount++;
  }

  // 4. Geração dos Furos do Padrão Circular BCD
  if (isBcdEnabled && holeCount > 0 && holeDia > 0 && BCD > 0) {
    const bcdRadius = BCD / 2;
    const holeRadius = holeDia / 2;
    const stepRad = (2 * Math.PI) / holeCount;
    const startRad = (startAng * Math.PI) / 180;

    for (let i = 0; i < holeCount; i++) {
      const angle = startRad + i * stepRad;
      const hx = bcdRadius * Math.cos(angle);
      const hy = bcdRadius * Math.sin(angle);

      circles.push({ type: 'circle', center: { x: hx, y: hy }, radius: holeRadius, layer: 'CUT' });
      piercingCount++;
    }
  }

  // 5. Cotas Técnicas
  // Diâmetros concêntricos (OD, BCD, ID) distribuídos em ângulos distintos (leque),
  // com cada rótulo pousando num anel comum fora do OD, para nunca se sobreporem.
  const diamCotas: { label: string; valueMm: number; r: number }[] = [
    { label: `Ø${OD} mm (OD)`, valueMm: OD, r: R_out },
  ];
  if (isBcdEnabled && holeCount > 0 && BCD > 0) {
    diamCotas.push({
      label: `BCD Ø${BCD.toFixed(1)} mm (${holeCount}× Ø${holeDia.toFixed(1)})`,
      valueMm: BCD,
      r: BCD / 2,
    });
  }
  if (ID > 0) {
    diamCotas.push({
      label: isKeywayEnabled ? `Ø${ID.toFixed(1)} mm (Eixo)` : `ID Ø${ID.toFixed(1)} mm`,
      valueMm: ID,
      r: ID / 2,
    });
  }
  const ringR = R_out + 28; // anel de pouso dos rótulos, fora da flange
  const baseAngleDeg = -35; // primeiro rótulo à direita-abaixo
  diamCotas.forEach((d, i) => {
    const ang = ((baseAngleDeg + (i * 360) / diamCotas.length) * Math.PI) / 180;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    cotas.push({
      type: 'diameter',
      start: { x: -d.r * ca, y: -d.r * sa },
      end: { x: d.r * ca, y: d.r * sa },
      label: d.label,
      valueMm: d.valueMm,
      offset: Math.max(12, ringR - d.r),
    });
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
