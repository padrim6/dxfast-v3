import {
  TemplateExecutionContext,
  TemplateGeometryOutput,
} from './types';
import {
  calculateBendParameters,
} from '../../utils/bendMath';
import {
  guardHoleDiameter,
  guardSlotLength,
  guardHoleMargin,
} from '../features/holeGuard';
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

export function solveGateGuideU(
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

  const isSymmetric = (params.symmetric ?? 1) !== 0;

  const rawA = params.baseA ?? 80;
  const rawB = isSymmetric ? (params.webB ?? 80) : (params.webB_left ?? 80);
  const rawB_right = isSymmetric ? (params.webB ?? 80) : (params.webB_right ?? 80);
  const rawC = isSymmetric ? (params.flareC ?? 50) : (params.flareC_left ?? 50);
  const rawC_right = isSymmetric ? (params.flareC ?? 50) : (params.flareC_right ?? 50);
  const rawAngle = isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_left ?? 45);
  const rawAngle_right = isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_right ?? 45);

  const L = Math.max(30, params.length ?? params.lengthL ?? 100);

  const rawRi = params.innerRadius ?? 3.0;
  if (rawRi > 20) {
    errors.push({
      code: 'BEND_RADIUS_EXCEEDS_MAX',
      severity: 'error',
      field: 'innerRadius',
      message: `Raio interno de dobra (${rawRi}mm) excede o limite máximo permitido de 20mm.`,
    });
  } else if (rawRi < 0.5) {
    errors.push({
      code: 'BEND_RADIUS_BELOW_MIN',
      severity: 'error',
      field: 'innerRadius',
      message: `Raio interno de dobra (${rawRi}mm) é inferior ao limite mínimo permitido de 0.5mm.`,
    });
  }

  // Setbacks and Bend Allowances (DIN 6935)
  // Dobras 1 e 4 (Abas C): flareAngle (contra-dobra / DOWN)
  const bendParamsFlareL = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 3.0,
    params.kFactor ?? 0.42,
    rawAngle
  );
  const bendParamsFlareR = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 3.0,
    params.kFactor ?? 0.42,
    rawAngle_right
  );
  const bendParamsBase = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 3.0,
    params.kFactor ?? 0.42,
    90
  );
  propagateBendWarnings(bendParamsFlareL, warnings);
  propagateBendWarnings(bendParamsFlareR, warnings);
  propagateBendWarnings(bendParamsBase, warnings);

  const T = bendParamsBase.thicknessMm;
  const Ri = bendParamsBase.internalRadiusMm;
  const K = bendParamsBase.kFactor;
  const Ro = Ri + T;

  const angle1Rad = (bendParamsFlareL.bendAngleDeg * Math.PI) / 180;
  const angle4Rad = (bendParamsFlareR.bendAngleDeg * Math.PI) / 180;
  const sb1_L = Math.tan(angle1Rad / 2) * Ro;
  const ba1_L = (Math.PI / 180) * bendParamsFlareL.bendAngleDeg * (Ri + K * T);
  const bd1_L = 2 * sb1_L - ba1_L;

  const sb1_R = Math.tan(angle4Rad / 2) * Ro;
  const ba1_R = (Math.PI / 180) * bendParamsFlareR.bendAngleDeg * (Ri + K * T);
  const bd1_R = 2 * sb1_R - ba1_R;

  // Dobras 2 e 3 (Base A): 90° (UP)
  const sb2 = Ro; // tan(45°) * Ro
  const ba2 = (Math.PI / 180) * 90 * (Ri + K * T);
  const bd2 = 2 * sb2 - ba2;

  // Geometric safety validations
  const minBaseA = Math.ceil(2 * Ro + 2 * T);
  const minWebB_L = Math.ceil(sb1_L + sb2 + 2);
  const minWebB_R = Math.ceil(sb1_R + sb2 + 2);
  const minFlareC_L = Math.ceil(sb1_L + 2);
  const minFlareC_R = Math.ceil(sb1_R + 2);

  const fA = Math.max(minBaseA, rawA);
  const fBL = Math.max(minWebB_L, rawB);
  const fBR = Math.max(minWebB_R, rawB_right);
  const fCL = Math.max(minFlareC_L, rawC);
  const fCR = Math.max(minFlareC_R, rawC_right);

  if (rawA < minBaseA) {
    warnings.push({
      field: 'baseA',
      message: `Base (A) ajustada para ${minBaseA}mm (mínimo de 2×(Ri+e)+2e para conformação de dobras).`,
      type: 'correction',
    });
  }
  if (rawB < minWebB_L || rawB_right < minWebB_R) {
    warnings.push({
      field: 'webB',
      message: `Aba lateral (B) ajustada para garantir espaço reto entre a dobra da base e a contra-dobra superior.`,
      type: 'correction',
    });
  }
  if (rawC < minFlareC_L || rawC_right < minFlareC_R) {
    warnings.push({
      field: 'flareC',
      message: `Aba de entrada (C) ajustada para comportar o raio de dobra escolhido.`,
      type: 'correction',
    });
  }

  // Straight segment lengths
  const cPrime_L = fCL - sb1_L;
  const bPrime_L = fBL - sb1_L - sb2;
  const aPrime = fA - 2 * sb2;
  const bPrime_R = fBR - sb2 - sb1_R;
  const cPrime_R = fCR - sb1_R;

  // Face widths developed on flat pattern
  const face0_blank = cPrime_L + ba1_L / 2;
  const face1_blank = bPrime_L + (ba1_L + ba2) / 2;
  const face2_blank = aPrime + ba2;
  const face3_blank = bPrime_R + (ba2 + ba1_R) / 2;
  const face4_blank = cPrime_R + ba1_R / 2;

  const totalW = Number((face0_blank + face1_blank + face2_blank + face3_blank + face4_blank).toFixed(4));
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const unfoldingMath = {
    thicknessMm: T,
    internalRadiusMm: Ri,
    kFactor: K,
    bendAngleDeg: 90,
    setbackMm: Number(sb2.toFixed(4)),
    bendAllowanceMm: Number(ba2.toFixed(4)),
    bendDeductionMm: Number(bd2.toFixed(4)),
    formulaExplanation: `DIN 6935 (K=${K}):
• Dobras da Base (2 e 3): 90° UP | SB=${sb2.toFixed(2)}mm | BA=${ba2.toFixed(2)}mm | BD=${bd2.toFixed(2)}mm
• Contra-dobras das Abas C (1 e 4): ${rawAngle}° DOWN | SB=${sb1_L.toFixed(2)}mm | BA=${ba1_L.toFixed(2)}mm | BD=${bd1_L.toFixed(2)}mm`,
  };

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;
  const bendCount = 4;

  // Positions of bend lines from left (-totalW/2)
  const b1Rel = face0_blank;
  const b2Rel = b1Rel + face1_blank;
  const b3Rel = b2Rel + face2_blank;
  const b4Rel = b3Rel + face3_blank;

  const b1Global = Number((-totalW / 2 + b1Rel).toFixed(4));
  const b2Global = Number((-totalW / 2 + b2Rel).toFixed(4));
  const b3Global = Number((-totalW / 2 + b3Rel).toFixed(4));
  const b4Global = Number((-totalW / 2 + b4Rel).toFixed(4));

  bendLines.push({
    id: 'bend_1',
    faceIndex: 0,
    label: `DOBRA 1 (${rawAngle}° DOWN | CONTRA-DOBRA | Ri=${Ri}mm)`,
    direction: 'DOWN',
    angleDeg: rawAngle,
    radiusMm: Ri,
    kFactor: K,
    positionX: b1Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: ba1_L,
    bendDeductionMm: bd1_L,
    setbackMm: sb1_L,
  });

  bendLines.push({
    id: 'bend_2',
    faceIndex: 1,
    label: `DOBRA 2 (90° UP | Ri=${Ri}mm)`,
    direction: 'UP',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b2Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: ba2,
    bendDeductionMm: bd2,
    setbackMm: sb2,
  });

  bendLines.push({
    id: 'bend_3',
    faceIndex: 2,
    label: `DOBRA 3 (90° UP | Ri=${Ri}mm)`,
    direction: 'UP',
    angleDeg: 90,
    radiusMm: Ri,
    kFactor: K,
    positionX: b3Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: ba2,
    bendDeductionMm: bd2,
    setbackMm: sb2,
  });

  bendLines.push({
    id: 'bend_4',
    faceIndex: 3,
    label: `DOBRA 4 (${rawAngle_right}° DOWN | CONTRA-DOBRA | Ri=${Ri}mm)`,
    direction: 'DOWN',
    angleDeg: rawAngle_right,
    radiusMm: Ri,
    kFactor: K,
    positionX: b4Global,
    startY: -L / 2,
    endY: L / 2,
    sheetThicknessMm: T,
    bendAllowanceMm: ba1_R,
    bendDeductionMm: bd1_R,
    setbackMm: sb1_R,
  });

  const faceSections: FaceSection[] = [
    {
      index: 0,
      name: 'Aba Entrada C (Esq)',
      widthNominalMm: fCL,
      widthBlankMm: face0_blank,
      startXBlankMm: -totalW / 2,
      endXBlankMm: b1Global,
      heightMm: L,
    },
    {
      index: 1,
      name: 'Alma Lateral B (Esq)',
      widthNominalMm: fBL,
      widthBlankMm: face1_blank,
      startXBlankMm: b1Global,
      endXBlankMm: b2Global,
      heightMm: L,
    },
    {
      index: 2,
      name: 'Base A',
      widthNominalMm: fA,
      widthBlankMm: face2_blank,
      startXBlankMm: b2Global,
      endXBlankMm: b3Global,
      heightMm: L,
    },
    {
      index: 3,
      name: 'Alma Lateral B (Dir)',
      widthNominalMm: fBR,
      widthBlankMm: face3_blank,
      startXBlankMm: b3Global,
      endXBlankMm: b4Global,
      heightMm: L,
    },
    {
      index: 4,
      name: 'Aba Entrada C (Dir)',
      widthNominalMm: fCR,
      widthBlankMm: face4_blank,
      startXBlankMm: b4Global,
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // Holes / Slots on Base A
  const holesEnabled = (params.holesBase ?? 1) !== 0;
  if (holesEnabled) {
    const rawHoleDia = params.holeDiameter ?? 10;
    const isOblong = (params.oblongHoles ?? 0) !== 0;
    const rawSlotLength = params.slotLength ?? 20;
    const rawPitch = params.holePitch ?? 50;
    const rawHoleQty = params.holeQty ?? 2;

    const baseCenterX = (b2Global + b3Global) / 2;
    const flatBaseWidth = aPrime;
    const maxPhysicalHoleDia = Math.max(0, flatBaseWidth - 2 * (1.5 * T));

    // Validação honesta do diâmetro do furo via função compartilhada
    const holeGuard = guardHoleDiameter({
      requestedDiameter: rawHoleDia,
      maxAvailableDiameter: maxPhysicalHoleDia,
      maxAllowedDiameter: 25,
      minDiameter: 4,
      field: 'holeDiameter',
      locationLabel: 'Base (A)',
    });

    if (!holeGuard.isValid && holeGuard.error) {
      errors.push(holeGuard.error);
    }

    // Validação honesta da quantidade de furos
    const holeQty = Math.round(rawHoleQty);
    if (rawHoleQty < 1 || rawHoleQty > 10) {
      errors.push({
        code: 'HOLE_QTY_OUT_OF_RANGE',
        severity: 'error',
        field: 'holeQty',
        message: `Quantidade de furos (${rawHoleQty}) deve estar entre 1 e 10.`,
      });
    }

    const effDia = holeGuard.diameter;
    const spanY = isOblong ? rawSlotLength : effDia;

    // Validação honesta do rasgo oblongo
    if (isOblong) {
      const slotGuard = guardSlotLength({
        requestedLength: rawSlotLength,
        holeDiameter: effDia,
        maxAvailableLength: L - 4,
        minLength: effDia + 2,
        maxAllowedLength: 100,
        field: 'slotLength',
        locationLabel: 'Base (A)',
      });
      if (!slotGuard.isValid && slotGuard.error) {
        errors.push(slotGuard.error);
      }
    }

    // Furação parametrizada por PASSO ENTRE CENTROS (center-to-center).
    // O padrão é centralizado no comprimento; a distância à borda é residual.
    const patternSpan = holeQty > 1 ? (holeQty - 1) * rawPitch : 0;
    // Margem residual (centro do furo extremo até a extremidade), somente informativa.
    const residualMargin = (L - patternSpan) / 2;

    if (holeQty > 1) {
      // Colisão: passo deve comportar o vão do furo mais folga mínima.
      if (rawPitch < spanY + 2) {
        errors.push({
          code: 'HOLE_OVERLAP',
          severity: 'error',
          field: 'holePitch',
          message: `Passo entre furos (${rawPitch.toFixed(1)}mm) menor que o mínimo seguro (${(spanY + 2).toFixed(1)}mm): os furos colidiriam.`,
        });
      }
      // Ajuste: o padrão deve caber com margem residual >= mínimo (borda ao centro).
      if (residualMargin < effDia) {
        errors.push({
          code: 'HOLE_PITCH_EXCEEDS_SPACE',
          severity: 'error',
          field: 'holePitch',
          message: `Passo entre furos (${rawPitch.toFixed(1)}mm) excede o espaço disponível: a margem residual (${residualMargin.toFixed(1)}mm) fica abaixo do mínimo seguro (${effDia.toFixed(1)}mm) em Base (A).`,
        });
      }
    }

    // Só desenha os furos se o diâmetro for válido (nunca desenha furo reduzido)
    if (holeGuard.isValid) {
      const holeDia = holeGuard.diameter;
      const slotLength = isOblong ? rawSlotLength : holeDia;

      for (let i = 0; i < holeQty; i++) {
        const hy = holeQty === 1 ? 0 : -patternSpan / 2 + i * rawPitch;
        if (isOblong) {
          innerPolylines.push(createSlotPolyline(baseCenterX, hy, slotLength, holeDia, true));
        } else {
          circles.push({
            type: 'circle',
            center: { x: baseCenterX, y: hy },
            radius: holeDia / 2,
            layer: 'CUT',
          });
        }
        piercingCount++;
      }

      // Cota de referência da margem residual (borda -> primeiro furo), auto-oculta.
      if (holeQty > 1 && residualMargin > 0) {
        const yFirst = -patternSpan / 2;
        cotas.push({
          type: 'linear',
          start: { x: baseCenterX, y: -L / 2 },
          end: { x: baseCenterX, y: yFirst },
          label: `borda ${residualMargin.toFixed(1)} mm (ref)`,
          valueMm: residualMargin,
          orientation: 'vertical',
          offset: -18,
        });
        // Cota principal do passo entre centros (primeiro -> segundo furo).
        cotas.push({
          type: 'linear',
          start: { x: baseCenterX, y: yFirst },
          end: { x: baseCenterX, y: yFirst + rawPitch },
          label: `passo ${rawPitch.toFixed(1)} mm (c/c)`,
          valueMm: rawPitch,
          orientation: 'vertical',
          offset: -18,
        });
      }
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
    unfoldingMath,
  };
}
