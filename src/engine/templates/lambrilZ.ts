import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  calculateBendParameters,
} from '../../utils/bendMath';
import {
  propagateBendWarnings,
  createRectangularContour,
  createSlotPolyline,
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

export function solveLambrilZ(
  context: TemplateExecutionContext
): TemplateGeometryOutput {
  const { params, sheetThickness } = context;
  const warnings: SanitizationWarning[] = [];
  const errors: GeometryIssue[] = [];
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];
  const cotas: DimensionCota[] = [];
  const bendLines: BendLine[] = [];

  const rawFaceA = params.faceA ?? 95;
  const rawStepB = params.stepB ?? 20;
  const linkLip = (params.linkLipToStep ?? 1) !== 0;
  const rawLipD = linkLip ? rawStepB : (params.lipD ?? 20);
  const equalFaces = (params.equalFaces ?? 0) !== 0;
  const rawFaceC = equalFaces ? rawFaceA : (params.faceC ?? 95);

  const L = Math.max(100, Math.min(6000, params.length ?? 2000));

  // DIN 6935 Unfolding Math for 4x 90° bends
  const bendParams = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 1.2,
    params.kFactor ?? 0.42,
    90
  );
  propagateBendWarnings(bendParams, warnings);

  const T = bendParams.thicknessMm;
  const Ri = bendParams.internalRadiusMm;
  const K = bendParams.kFactor;

  const minStraightFace = 2 * (Ri + T);
  const minLip = (Ri + T) + 2 * T;

  const fA = Math.max(minStraightFace, rawFaceA);
  const fB = Math.max(minStraightFace, rawStepB);
  const fC = Math.max(minStraightFace, rawFaceC);
  const fD = Math.max(minLip, rawLipD);

  if (rawFaceA < minStraightFace) {
    warnings.push({
      field: 'faceA',
      message: `Face Superior (A) ajustada para ${minStraightFace.toFixed(1)}mm para comportar as duas dobras de raio Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawStepB < minStraightFace) {
    warnings.push({
      field: 'stepB',
      message: `Altura do Degrau (B) ajustada para ${minStraightFace.toFixed(1)}mm para comportar as dobras em Z.`,
      type: 'correction',
    });
  }
  if (rawFaceC < minStraightFace) {
    warnings.push({
      field: 'faceC',
      message: `Face Inferior (C) ajustada para ${minStraightFace.toFixed(1)}mm para comportar as duas dobras adjacentes.`,
      type: 'correction',
    });
  }
  if (rawLipD < minLip) {
    warnings.push({
      field: 'lipD',
      message: `Retorno das Extremidades (D) ajustado para ${minLip.toFixed(1)}mm para permitir aba mínima de conformação.`,
      type: 'correction',
    });
  }

  if (fD > fB) {
    warnings.push({
      field: 'lipD',
      message: `Atenção: O retorno (D=${fD.toFixed(1)}mm) é maior que o degrau (B=${fB.toFixed(1)}mm), o que pode causar interferência na montagem sobreposta entre lâminas.`,
      type: 'warning',
    });
  }

  const SB = bendParams.setbackMm; // (Ri + T) * tan(45°) = Ri + T
  const BA = bendParams.bendAllowanceMm; // (PI/2) * (Ri + K * T)
  const BD = bendParams.bendDeductionMm; // 2*SB - BA

  const d1Prime = fD - SB;
  const aPrime = fA - 2 * SB;
  const bPrime = fB - 2 * SB;
  const cPrime = fC - 2 * SB;
  const d2Prime = fD - SB;

  const totalW = d1Prime + aPrime + bPrime + cPrime + d2Prime + 4 * BA;
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;
  const bendCount = 4;

  // Cumulative bend line positions from left edge (0 to totalW)
  const x1_rel = fD - BD / 2;
  const x2_rel = x1_rel + BA + aPrime;
  const x3_rel = x2_rel + BA + bPrime;
  const x4_rel = x3_rel + BA + cPrime;

  const b1Global = -totalW / 2 + x1_rel;
  const b2Global = -totalW / 2 + x2_rel;
  const b3Global = -totalW / 2 + x3_rel;
  const b4Global = -totalW / 2 + x4_rel;

  // 4 Bend Lines: Dobras 1 e 2 = UP | Dobras 3 e 4 = DOWN (Contra-dobra)
  bendLines.push({
    id: 'bend_1',
    faceIndex: 0,
    label: `DOBRA 1: UP 90° (Ri ${Ri}mm)`,
    direction: 'UP',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b1Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: BA,
    bendDeductionMm: BD,
    setbackMm: SB,
  });

  bendLines.push({
    id: 'bend_2',
    faceIndex: 1,
    label: `DOBRA 2: UP 90° (Ri ${Ri}mm)`,
    direction: 'UP',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b2Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: BA,
    bendDeductionMm: BD,
    setbackMm: SB,
  });

  bendLines.push({
    id: 'bend_3',
    faceIndex: 2,
    label: `DOBRA 3: DOWN 90° (Ri ${Ri}mm)`,
    direction: 'DOWN',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b3Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: BA,
    bendDeductionMm: BD,
    setbackMm: SB,
  });

  bendLines.push({
    id: 'bend_4',
    faceIndex: 3,
    label: `DOBRA 4: DOWN 90° (Ri ${Ri}mm)`,
    direction: 'DOWN',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b4Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: BA,
    bendDeductionMm: BD,
    setbackMm: SB,
  });

  // Profile Faces
  const faceSections: FaceSection[] = [
    {
      index: 0,
      name: 'Retorno Esq (D)',
      widthNominalMm: fD,
      widthBlankMm: x1_rel,
      startXBlankMm: -totalW / 2,
      endXBlankMm: b1Global,
      heightMm: L,
    },
    {
      index: 1,
      name: 'Face Sup (A)',
      widthNominalMm: fA,
      widthBlankMm: x2_rel - x1_rel,
      startXBlankMm: b1Global,
      endXBlankMm: b2Global,
      heightMm: L,
    },
    {
      index: 2,
      name: 'Alma / Degrau (B)',
      widthNominalMm: fB,
      widthBlankMm: x3_rel - x2_rel,
      startXBlankMm: b2Global,
      endXBlankMm: b3Global,
      heightMm: L,
    },
    {
      index: 3,
      name: 'Face Inf (C)',
      widthNominalMm: fC,
      widthBlankMm: x4_rel - x3_rel,
      startXBlankMm: b3Global,
      endXBlankMm: b4Global,
      heightMm: L,
    },
    {
      index: 4,
      name: 'Retorno Dir (D)',
      widthNominalMm: fD,
      widthBlankMm: totalW - x4_rel,
      startXBlankMm: b4Global,
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // Holes / Slots for fixing (Face A, Face C, or Both)
  const holesEnabled = (params.holesFixing ?? 0) !== 0;
  if (holesEnabled) {
    const rawHoleFace = Math.round(params.holeFace ?? 0);
    // 0 = Face A, 1 = Face C, 2 = Ambas as faces
    const applyToA = rawHoleFace === 0 || rawHoleFace === 2;
    const applyToC = rawHoleFace === 1 || rawHoleFace === 2;

    const holeQty = Math.max(1, Math.min(20, Math.round(params.holeQty ?? 2)));
    const rawHoleDia = Math.max(2, Math.min(15, params.holeDiameter ?? 4.8));
    const rawPitch = Math.max(8, params.holePitch ?? 200);
    const isOblong = (params.oblongHoles ?? 0) !== 0;
    const rawSlotLength = Math.max(rawHoleDia + 2, Math.min(60, params.slotLength ?? 12));

    const faceCenterXA = (b1Global + b2Global) / 2;
    const faceCenterXC = (b3Global + b4Global) / 2;

    const maxHoleDiaA = Math.max(2, aPrime - 2 * (1.5 * T));
    const maxHoleDiaC = Math.max(2, cPrime - 2 * (1.5 * T));

    let maxHoleDia: number;
    if (rawHoleFace === 2) {
      maxHoleDia = Math.min(maxHoleDiaA, maxHoleDiaC);
    } else if (rawHoleFace === 1) {
      maxHoleDia = maxHoleDiaC;
    } else {
      maxHoleDia = maxHoleDiaA;
    }

    const holeDia = Math.min(rawHoleDia, maxHoleDia);

    if (rawHoleDia > maxHoleDia) {
      let advice = '';
      if (rawHoleFace === 2) {
        const limiting = maxHoleDiaA < maxHoleDiaC ? 'Face A' : (maxHoleDiaC < maxHoleDiaA ? 'Face C' : 'ambas as faces');
        advice = ` (limitado pela ${limiting}).`;
      } else if (rawHoleFace === 1) {
        advice = ' Troque para Face A se for mais larga.';
      } else {
        advice = ' Troque para Face C se for mais larga.';
      }
      warnings.push({
        field: 'holeDiameter',
        message: `Diâmetro dos furos limitado a ${maxHoleDia.toFixed(1)}mm para manter folga segura de 1.5×e das linhas de dobra.${advice}`,
        type: 'correction',
      });
    }

    // Furação por PASSO ENTRE CENTROS: padrão centralizado no comprimento.
    // A distância à borda é residual (somente informativa).
    const spanY = isOblong ? rawSlotLength : holeDia;
    const patternSpan = holeQty > 1 ? (holeQty - 1) * rawPitch : 0;
    const residualMargin = (L - patternSpan) / 2;

    if (holeQty > 1) {
      if (rawPitch < spanY + 2) {
        errors.push({
          code: 'HOLE_OVERLAP',
          severity: 'error',
          field: 'holePitch',
          message: `Passo entre furos (${rawPitch.toFixed(1)}mm) menor que o mínimo seguro (${(spanY + 2).toFixed(1)}mm): os furos colidiriam.`,
        });
      }
      if (residualMargin < holeDia) {
        errors.push({
          code: 'HOLE_PITCH_EXCEEDS_SPACE',
          severity: 'error',
          field: 'holePitch',
          message: `Passo entre furos (${rawPitch.toFixed(1)}mm) excede o espaço: a margem residual (${residualMargin.toFixed(1)}mm) fica abaixo do mínimo (${holeDia.toFixed(1)}mm).`,
        });
      }
    }

    const targetFaces: { name: string; centerX: number }[] = [];
    if (applyToA) targetFaces.push({ name: 'A', centerX: faceCenterXA });
    if (applyToC) targetFaces.push({ name: 'C', centerX: faceCenterXC });

    for (const face of targetFaces) {
      for (let i = 0; i < holeQty; i++) {
        const hy = holeQty === 1 ? 0 : -patternSpan / 2 + i * rawPitch;
        if (isOblong) {
          innerPolylines.push(createSlotPolyline(face.centerX, hy, rawSlotLength, holeDia, true));
        } else {
          circles.push({
            type: 'circle',
            center: { x: face.centerX, y: hy },
            radius: holeDia / 2,
            layer: 'CUT',
          });
        }
        piercingCount++;
      }
    }

    // Cotas de furação (passo c/c principal + margem residual de referência).
    if (targetFaces.length > 0 && holeQty > 1 && residualMargin > 0) {
      const cx = targetFaces[0].centerX;
      const yFirst = -patternSpan / 2;
      cotas.push({
        type: 'linear',
        start: { x: cx, y: yFirst },
        end: { x: cx, y: yFirst + rawPitch },
        label: `passo ${rawPitch.toFixed(1)} mm (c/c)`,
        valueMm: rawPitch,
        orientation: 'vertical',
        offset: -18,
      });
      cotas.push({
        type: 'linear',
        start: { x: cx, y: -L / 2 },
        end: { x: cx, y: yFirst },
        label: `borda ${residualMargin.toFixed(1)} mm (ref)`,
        valueMm: residualMargin,
        orientation: 'vertical',
        offset: -18,
      });
    }
  }

  // Cotas principais do blank
  cotas.push({
    type: 'linear',
    start: { x: -totalW / 2, y: L / 2 },
    end: { x: totalW / 2, y: L / 2 },
    label: `${totalW.toFixed(1)} mm (Lplan)`,
    valueMm: totalW,
    orientation: 'horizontal',
    offset: 25,
  });
  cotas.push({
    type: 'linear',
    start: { x: totalW / 2, y: -L / 2 },
    end: { x: totalW / 2, y: L / 2 },
    label: `${L.toFixed(1)} mm (L)`,
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
