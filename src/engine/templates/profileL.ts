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

export function solveProfileL(
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

  const rawA = params.flangeA || 50;
  const rawB = params.flangeB || 50;
  const L = Math.max(20, params.lengthL || 250);

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

  const fA = Math.max(minFlange, rawA);
  const fB = Math.max(minFlange, rawB);

  if (rawA < minFlange) {
    warnings.push({
      field: 'flangeA',
      message: `Aba A ajustada para ${fA}mm para comportar o raio de dobra Ri=${Ri}mm e espessura e=${T}mm.`,
      type: 'correction',
    });
  }
  if (rawB < minFlange) {
    warnings.push({
      field: 'flangeB',
      message: `Aba B ajustada para ${fB}mm para comportar o raio de dobra Ri=${Ri}mm e espessura e=${T}mm.`,
      type: 'correction',
    });
  }

  const blankResult = calculateProfileBlank([fA, fB], bendParams);
  const totalW = blankResult.totalBlankWidthMm;
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;

  const bendXRel = blankResult.bendPositionsX[0];
  const bendXGlobal = -totalW / 2 + bendXRel;
  const bendCount = 1;

  bendLines.push({
    id: 'bend_1',
    faceIndex: 0,
    label: `DOBRA 1 (${angle}° UP | Ri=${Ri}mm)`,
    direction: 'UP',
    angleDeg: angle,
    radiusMm: Ri,
    kFactor: K,
    positionX: bendXGlobal,
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
      name: 'Aba A',
      widthNominalMm: fA,
      widthBlankMm: blankResult.faceWidthsBlankMm[0],
      startXBlankMm: -totalW / 2,
      endXBlankMm: bendXGlobal,
      heightMm: L,
    },
    {
      index: 1,
      name: 'Aba B',
      widthNominalMm: fB,
      widthBlankMm: blankResult.faceWidthsBlankMm[1],
      startXBlankMm: bendXGlobal,
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // Face Holes feature
  if (features.faceHoles?.enabled) {
    const faceSel = String(features.faceHoles.params.faceSelect || 'abaA');
    const holeType = String(features.faceHoles.params.holeType || 'circle');
    const rawD = Number(features.faceHoles.params.diameter || 12);
    const slotLen = Number(features.faceHoles.params.slotLength || 24);
    const count = Math.max(1, Math.min(12, Number(features.faceHoles.params.count || 2)));
    const spY = Number(features.faceHoles.params.spacingX || 100);

    const targetFace = faceSel === 'abaB' ? faceSections[1] : faceSections[0];
    const maxD = Math.max(3, targetFace.endXBlankMm - targetFace.startXBlankMm - 2 * MIN_WALL_GAP);
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
  cotas.push({
    type: 'bend',
    start: { x: bendXGlobal, y: -L / 2 },
    end: { x: bendXGlobal, y: L / 2 },
    label: `Linha de Dobra 1 (X=${bendXRel.toFixed(1)}mm)`,
    valueMm: bendXRel,
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
