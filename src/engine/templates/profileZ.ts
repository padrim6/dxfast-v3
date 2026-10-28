import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  calculateBendParameters,
  calculateProfileBlank,
} from '../../utils/bendMath';
import {
  propagateBendWarnings,
  createRectangularContour,
  createSlotPolyline,
  MIN_WALL_GAP,
} from '../helpers';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  BendLine,
  FaceSection,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveProfileZ(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, features, sheetThickness } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];
  const bendLines: BendLine[] = [];

  const rawA = params.flangeA || 40;
  const rawB = params.flangeB || 120;
  const rawC = params.flangeC || 40;
  const L = Math.max(20, params.lengthL || 350);

  const bendParams = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 3.0,
    params.kFactor ?? 0.44,
    params.bendAngle ?? 90
  );
  propagateBendWarnings(bendParams, warnings);

  const T = bendParams.thicknessMm;
  const Ri = bendParams.internalRadiusMm;
  const K = bendParams.kFactor;
  const angle = bendParams.bendAngleDeg;

  const Ro = Ri + T;
  const osb = Math.tan(((angle / 2) * Math.PI) / 180) * Ro;
  const minFlange = Math.ceil(osb + 2);
  const minWeb = Math.ceil(2 * osb + 4);

  let fA = Math.max(minFlange, rawA);
  let fB = Math.max(minWeb, rawB);
  let fC = Math.max(minFlange, rawC);

  if (rawA < minFlange) {
    warnings.push({
      field: 'flangeA',
      message: `Aba Superior A ajustada para ${fA}mm para comportar o raio de dobra Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawB < minWeb) {
    warnings.push({
      field: 'flangeB',
      message: `Alma Central B ajustada para ${fB}mm para comportar as duas dobras com raio Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawC < minFlange) {
    warnings.push({
      field: 'flangeC',
      message: `Aba Inferior C ajustada para ${fC}mm para comportar o raio de dobra Ri=${Ri}mm.`,
      type: 'correction',
    });
  }

  // Proteção Anti-Colisão para Perfil Z em dobras agudas/obtusas (> 90°)
  if (angle > 90) {
    const cosFactor = -Math.cos(((angle) * Math.PI) / 180);
    const maxFlange = Math.max(minFlange, (fB - T - 2) / cosFactor);
    if (fA > maxFlange || fC > maxFlange) {
      const safeA = Math.min(fA, maxFlange);
      const safeC = Math.min(fC, maxFlange);
      if (safeA < fA || safeC < fC) {
        fA = Number(safeA.toFixed(1));
        fC = Number(safeC.toFixed(1));
        warnings.push({
          field: 'bendAngle',
          message: `Abas Superior e Inferior ajustadas para ${fA}mm e ${fC}mm para evitar colisão contra a Alma no ângulo de ${angle}°.`,
          type: 'correction',
        });
      }
    }
  }

  const blankResult = calculateProfileBlank([fA, fB, fC], bendParams);
  const totalW = blankResult.totalBlankWidthMm;
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;

  const b1XRel = blankResult.bendPositionsX[0];
  const b2XRel = blankResult.bendPositionsX[1];
  const b1Global = -totalW / 2 + b1XRel;
  const b2Global = -totalW / 2 + b2XRel;
  const bendCount = 2;

  bendLines.push({
    id: 'bend_1',
    faceIndex: 0,
    label: `DOBRA 1 (${angle}° UP | Ri=${Ri}mm)`,
    direction: 'UP',
    angleDeg: angle,
    radiusMm: Ri,
    kFactor: K,
    positionX: b1Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: bendParams.bendAllowanceMm,
    bendDeductionMm: bendParams.bendDeductionMm,
    setbackMm: bendParams.setbackMm,
  });

  bendLines.push({
    id: 'bend_2',
    faceIndex: 1,
    label: `DOBRA 2 (${angle}° DOWN | Ri=${Ri}mm)`,
    direction: 'DOWN',
    angleDeg: angle,
    radiusMm: Ri,
    kFactor: K,
    positionX: b2Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: bendParams.bendAllowanceMm,
    bendDeductionMm: bendParams.bendDeductionMm,
    setbackMm: bendParams.setbackMm,
  });

  const faceSections: FaceSection[] = [
    {
      index: 0,
      name: 'Aba Superior A',
      widthNominalMm: fA,
      widthBlankMm: blankResult.faceWidthsBlankMm[0],
      startXBlankMm: -totalW / 2,
      endXBlankMm: b1Global,
      heightMm: L,
    },
    {
      index: 1,
      name: 'Alma Central B',
      widthNominalMm: fB,
      widthBlankMm: blankResult.faceWidthsBlankMm[1],
      startXBlankMm: b1Global,
      endXBlankMm: b2Global,
      heightMm: L,
    },
    {
      index: 2,
      name: 'Aba Inferior C',
      widthNominalMm: fC,
      widthBlankMm: blankResult.faceWidthsBlankMm[2],
      startXBlankMm: b2Global,
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // Face Holes feature for profile_z
  if (features.faceHoles?.enabled) {
    const faceSel = String(features.faceHoles.params.faceSelect || 'alma');
    const holeType = String(features.faceHoles.params.holeType || 'circle');
    const rawD = Number(features.faceHoles.params.diameter || 14);
    const slotLen = Number(features.faceHoles.params.slotLength || 28);
    const count = Math.max(1, Math.min(12, Number(features.faceHoles.params.count || 2)));
    const spY = Number(features.faceHoles.params.spacingX || 120);

    let targetFace = faceSections[1]; // Alma
    if (faceSel === 'abaA') targetFace = faceSections[0];
    if (faceSel === 'abaC') targetFace = faceSections[2];

    const maxD = Math.max(3, (targetFace.endXBlankMm - targetFace.startXBlankMm) - 2 * MIN_WALL_GAP);
    const d = Math.min(rawD, maxD);

    const cxFace = (targetFace.startXBlankMm + targetFace.endXBlankMm) / 2;
    const stepY = count > 1 ? Math.min((L - 40) / (count - 1), spY) : 0;
    const startY = -((count - 1) * stepY) / 2;

    for (let i = 0; i < count; i++) {
      const hy = startY + i * stepY;
      if (Math.abs(hy) < L / 2 - 10) {
        if (holeType === 'slot') {
          innerPolylines.push(createSlotPolyline(cxFace, hy, slotLen, d, true));
        } else {
          circles.push({ type: 'circle', center: { x: cxFace, y: hy }, radius: d / 2, layer: 'CUT' });
        }
        piercingCount++;
      }
    }
  }

  cotas.push({
    type: 'linear',
    start: { x: -totalW / 2, y: L / 2 },
    end: { x: totalW / 2, y: L / 2 },
    label: `${totalW.toFixed(1)} mm`,
    valueMm: totalW,
    orientation: 'horizontal',
    offset: 25,
  });
  cotas.push({
    type: 'linear',
    start: { x: totalW / 2, y: -L / 2 },
    end: { x: totalW / 2, y: L / 2 },
    label: `${L.toFixed(1)} mm`,
    valueMm: L,
    orientation: 'vertical',
    offset: 25,
  });

  return {
    outerPolylines,
    innerPolylines,
    circles,
    bendLines,
    faceSections,
    cotas,
    warnings,
    errors,
    piercingCount,
    bendCount,
    blankWidthMm,
    blankHeightMm,
    unfoldingMath: bendParams,
  };
}
