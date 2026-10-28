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
  guardHoleDiameter,
  guardSlotLength,
} from '../features/holeGuard';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  BendLine,
  FaceSection,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveProfileHat(
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

  const rawA = params.flangeA || 25;
  const rawB = params.flangeB || 40;
  const rawC = params.flangeC || 80;
  const rawD = params.flangeD || 40;
  const rawE = params.flangeE || 25;
  const L = Math.max(20, params.lengthL || 300);

  const bendParams = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 2.0,
    params.kFactor ?? 0.44,
    90
  );
  propagateBendWarnings(bendParams, warnings);

  const T = bendParams.thicknessMm;
  const Ri = bendParams.internalRadiusMm;
  const K = bendParams.kFactor;

  const Ro = Ri + T;
  const osb = Ro; // 90 deg
  const minFlange = Math.ceil(osb + 2);
  const minWeb = Math.ceil(2 * osb + 4);

  const fA = Math.max(minFlange, rawA);
  const fB = Math.max(minWeb, rawB);
  const fC = Math.max(minWeb, rawC);
  const fD = Math.max(minWeb, rawD);
  const fE = Math.max(minFlange, rawE);

  if (rawA < minFlange) {
    warnings.push({
      field: 'flangeA',
      message: `Aba de fixação A1 ajustada para o mínimo de ${minFlange}mm para comportar raio Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawE < minFlange) {
    warnings.push({
      field: 'flangeE',
      message: `Aba de fixação A2 ajustada para o mínimo de ${minFlange}mm para comportar raio Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawB < minWeb) {
    warnings.push({
      field: 'flangeB',
      message: `Aba vertical B1 ajustada para ${minWeb}mm para comportar as dobras superior e inferior.`,
      type: 'correction',
    });
  }
  if (rawD < minWeb) {
    warnings.push({
      field: 'flangeD',
      message: `Aba vertical B2 ajustada para ${minWeb}mm para comportar as dobras superior e inferior.`,
      type: 'correction',
    });
  }
  if (rawC < minWeb) {
    warnings.push({
      field: 'flangeC',
      message: `Alma de topo ajustada para ${minWeb}mm para comportar o raio Ri=${Ri}mm.`,
      type: 'correction',
    });
  }

  const blankResult = calculateProfileBlank([fA, fB, fC, fD, fE], bendParams);
  const totalW = blankResult.totalBlankWidthMm;
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;
  const bendCount = 4;

  const bGlobals: number[] = [];
  for (let b = 0; b < 4; b++) {
    const bRel = blankResult.bendPositionsX[b];
    const bGlobal = -totalW / 2 + bRel;
    bGlobals.push(bGlobal);
    const dir: 'UP' | 'DOWN' = b === 0 || b === 3 ? 'UP' : 'DOWN';
    bendLines.push({
      id: `bend_${b + 1}`,
      faceIndex: b,
      label: `DOBRA ${b + 1} (90° ${dir})`,
      direction: dir,
      angleDeg: 90,
      radiusMm: Ri,
      kFactor: K,
      positionX: bGlobal,
      startY: -L / 2,
      endY: L / 2,
      sheetThicknessMm: T,
      bendAllowanceMm: bendParams.bendAllowanceMm,
      bendDeductionMm: bendParams.bendDeductionMm,
      setbackMm: bendParams.setbackMm,
    });
  }

  const faceSections: FaceSection[] = [
    {
      index: 0,
      name: 'Aba Fixação A1',
      widthNominalMm: fA,
      widthBlankMm: blankResult.faceWidthsBlankMm[0],
      startXBlankMm: -totalW / 2,
      endXBlankMm: bGlobals[0],
      heightMm: L,
    },
    {
      index: 1,
      name: 'Aba Vertical B1',
      widthNominalMm: fB,
      widthBlankMm: blankResult.faceWidthsBlankMm[1],
      startXBlankMm: bGlobals[0],
      endXBlankMm: bGlobals[1],
      heightMm: L,
    },
    {
      index: 2,
      name: 'Alma Topo C',
      widthNominalMm: fC,
      widthBlankMm: blankResult.faceWidthsBlankMm[2],
      startXBlankMm: bGlobals[1],
      endXBlankMm: bGlobals[2],
      heightMm: L,
    },
    {
      index: 3,
      name: 'Aba Vertical B2',
      widthNominalMm: fD,
      widthBlankMm: blankResult.faceWidthsBlankMm[3],
      startXBlankMm: bGlobals[2],
      endXBlankMm: bGlobals[3],
      heightMm: L,
    },
    {
      index: 4,
      name: 'Aba Fixação A2',
      widthNominalMm: fE,
      widthBlankMm: blankResult.faceWidthsBlankMm[4],
      startXBlankMm: bGlobals[3],
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // Face Holes feature for profile_hat
  if (features.faceHoles?.enabled) {
    const faceSel = String(features.faceHoles.params.faceSelect || 'alma');
    const holeType = String(features.faceHoles.params.holeType || 'circle');
    const rawD = Number(features.faceHoles.params.diameter || 10);
    const slotLen = Number(features.faceHoles.params.slotLength || 20);
    const rawCount = Number(features.faceHoles.params.count || 2);
    const spY = Number(features.faceHoles.params.spacingX || 100);

    let targetFace = faceSections[2]; // Alma Topo C
    if (faceSel === 'abaA' || faceSel === 'abaA1') targetFace = faceSections[0];
    if (faceSel === 'abaB' || faceSel === 'abaB1') targetFace = faceSections[1];
    if (faceSel === 'abaB2' || faceSel === 'abaD') targetFace = faceSections[3];
    if (faceSel === 'abaC' || faceSel === 'abaA2' || faceSel === 'abaE') targetFace = faceSections[4];

    const faceBlankWidth = targetFace.endXBlankMm - targetFace.startXBlankMm;
    const maxPhysicalHoleDia = Math.max(0, faceBlankWidth - 2 * MIN_WALL_GAP);
    const maxDiaL = Math.max(0, L - 20);
    const maxAvailableDia = Math.min(maxPhysicalHoleDia, maxDiaL);

    // Validação honesta de diâmetro via holeGuard
    const holeGuard = guardHoleDiameter({
      requestedDiameter: rawD,
      maxAvailableDiameter: maxAvailableDia,
      maxAllowedDiameter: 50,
      minDiameter: 3,
      field: 'faceHoles.diameter',
      locationLabel: `Face ${targetFace.name}`,
    });

    if (!holeGuard.isValid && holeGuard.error) {
      errors.push(holeGuard.error);
    }

    const effDia = holeGuard.diameter;

    // Validação honesta de rasgo oblongo via guardSlotLength
    if (holeType === 'slot') {
      const slotGuard = guardSlotLength({
        requestedLength: slotLen,
        holeDiameter: effDia,
        maxAvailableLength: L - 20,
        minLength: effDia + 2,
        maxAllowedLength: 100,
        field: 'faceHoles.slotLength',
        locationLabel: `Face ${targetFace.name}`,
      });
      if (!slotGuard.isValid && slotGuard.error) {
        errors.push(slotGuard.error);
      }
    }

    const count = Math.max(1, Math.min(12, Math.round(rawCount)));
    const cxFace = (targetFace.startXBlankMm + targetFace.endXBlankMm) / 2;
    const stepY = count > 1 ? Math.min((L - 40) / (count - 1), spY) : 0;
    const startY = -((count - 1) * stepY) / 2;

    for (let i = 0; i < count; i++) {
      const hy = startY + i * stepY;
      if (Math.abs(hy) <= L / 2 - 10) {
        if (holeType === 'slot') {
          innerPolylines.push(createSlotPolyline(cxFace, hy, slotLen, effDia, true));
        } else {
          circles.push({ type: 'circle', center: { x: cxFace, y: hy }, radius: effDia / 2, layer: 'CUT' });
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
