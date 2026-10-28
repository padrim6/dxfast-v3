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
  SlotGuardResult,
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

export function solveGateWeightBox(
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

  const rawHeightA = params.heightA ?? 150;
  const isSquare = (params.squareSection ?? 0) !== 0;
  const rawWidthB = isSquare ? rawHeightA : (params.widthB ?? 100);

  const L = Math.max(50, Math.min(6000, params.length ?? 2000));
  const seamGap = Math.max(0, Math.min(10, params.seamGap ?? 1.0));

  // DIN 6935 Bend Calculations for 4x 90° bends
  const bendParams = calculateBendParameters(
    sheetThickness,
    params.innerRadius ?? 1.5,
    params.kFactor ?? 0.42,
    90
  );
  propagateBendWarnings(bendParams, warnings);

  const T = bendParams.thicknessMm;
  const Ri = bendParams.internalRadiusMm;
  const K = bendParams.kFactor;

  const SB = bendParams.setbackMm; // Ri + T for 90°
  const BA = bendParams.bendAllowanceMm; // (PI / 2) * (Ri + K * T)
  const BD = bendParams.bendDeductionMm; // 2 * SB - BA

  // Minimum straight face check
  const minFace = 2 * SB + 4;
  const fA = Math.max(minFace, rawHeightA);
  const fB = Math.max(minFace, rawWidthB);

  if (rawHeightA < minFace) {
    warnings.push({
      field: 'heightA',
      message: `Face Maior (A) ajustada para ${minFace.toFixed(1)}mm para comportar o raio de dobra Ri=${Ri}mm.`,
      type: 'correction',
    });
  }
  if (rawWidthB < minFace && !isSquare) {
    warnings.push({
      field: 'widthB',
      message: `Face Menor (B) ajustada para ${minFace.toFixed(1)}mm para comportar o raio de dobra Ri=${Ri}mm.`,
      type: 'correction',
    });
  }

  // Emenda sempre no centro da Face B: [B/2 - gap/2] -> [A] -> [B] -> [A] -> [B/2 - gap/2] (4 Dobras)
  const l1 = fB / 2 - SB - seamGap / 2;
  const l2 = fA - 2 * SB;
  const l3 = fB - 2 * SB;
  const l4 = fA - 2 * SB;
  const l5 = fB / 2 - SB - seamGap / 2;
  const faceNames = [
    'Meia Face B1 (Topo Esq.)',
    'Face Maior A1 (Lateral Esq.)',
    'Face Menor B (Fundo)',
    'Face Maior A2 (Lateral Dir.)',
    'Meia Face B2 (Topo Dir.)',
  ];
  const faceNominals = [fB / 2, fA, fB, fA, fB / 2];

  const totalW = 2 * (fA + fB) - 4 * BD - seamGap;
  const bendCount = 4;

  const x1_rel = l1 + BA / 2;
  const x2_rel = x1_rel + BA / 2 + l2 + BA / 2;
  const x3_rel = x2_rel + BA / 2 + l3 + BA / 2;
  const x4_rel = x3_rel + BA / 2 + l4 + BA / 2;

  const b1Global = -totalW / 2 + x1_rel;
  const b2Global = -totalW / 2 + x2_rel;
  const b3Global = -totalW / 2 + x3_rel;
  const b4Global = -totalW / 2 + x4_rel;

  const blankWidthMm = totalW;
  const blankHeightMm = L;

  const outerContour = createRectangularContour(totalW, L, 0, 0);
  outerPolylines.push(outerContour);

  let piercingCount = 1;

  // All bends are UP 90° in the same direction for a closed tubular profile
  bendLines.push(
    {
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
    },
    {
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
    },
    {
      id: 'bend_3',
      faceIndex: 2,
      label: `DOBRA 3: UP 90° (Ri ${Ri}mm)`,
      direction: 'UP',
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
    },
    {
      id: 'bend_4',
      faceIndex: 3,
      label: `DOBRA 4: UP 90° (Ri ${Ri}mm)`,
      direction: 'UP',
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
    }
  );

  // Face Sections (5 seções com emenda no centro da Face B)
  const faceSections: FaceSection[] = [
    {
      index: 0,
      name: faceNames[0],
      widthNominalMm: faceNominals[0],
      widthBlankMm: x1_rel,
      startXBlankMm: -totalW / 2,
      endXBlankMm: b1Global,
      heightMm: L,
    },
    {
      index: 1,
      name: faceNames[1],
      widthNominalMm: faceNominals[1],
      widthBlankMm: x2_rel - x1_rel,
      startXBlankMm: b1Global,
      endXBlankMm: b2Global,
      heightMm: L,
    },
    {
      index: 2,
      name: faceNames[2],
      widthNominalMm: faceNominals[2],
      widthBlankMm: x3_rel - x2_rel,
      startXBlankMm: b2Global,
      endXBlankMm: b3Global,
      heightMm: L,
    },
    {
      index: 3,
      name: faceNames[3],
      widthNominalMm: faceNominals[3],
      widthBlankMm: x4_rel - x3_rel,
      startXBlankMm: b3Global,
      endXBlankMm: b4Global,
      heightMm: L,
    },
    {
      index: 4,
      name: faceNames[4],
      widthNominalMm: faceNominals[4],
      widthBlankMm: totalW - x4_rel,
      startXBlankMm: b4Global,
      endXBlankMm: totalW / 2,
      heightMm: L,
    },
  ];

  // -----------------------------------------------------------------------
  // FURAÇÕES: FUROS DE DRENO NAS EXTREMIDADES (TOPO E FUNDO)
  // -----------------------------------------------------------------------
  const hasDrain = (params.holesDrain ?? 1) !== 0;
  if (hasDrain) {
    const rawDrainDia = params.drainDiameter ?? 8.0;
    const rawDrainQty = Math.round(params.drainQty ?? 2);
    // Distância entre centros das duas fileiras de dreno (topo e fundo).
    const rawDrainSpacing = params.drainRowSpacing ?? 1940;

    // Drenos localizados na Face Central 3 (Face Menor B - Fundo)
    const faceFlatW = l3;
    const faceCenterX = (b2Global + b3Global) / 2;

    const drainDivisor = rawDrainQty === 1 ? 1 : rawDrainQty === 2 ? 4 : (rawDrainQty + 1);
    const maxPhysicalDrainDia = Math.max(0, (faceFlatW - 0.05) / drainDivisor);

    const drainDiaGuard = guardHoleDiameter({
      requestedDiameter: rawDrainDia,
      maxAvailableDiameter: maxPhysicalDrainDia,
      maxAllowedDiameter: 25,
      minDiameter: 4,
      field: 'drainDiameter',
      locationLabel: 'Face Menor (B) - Fundo',
    });
    if (!drainDiaGuard.isValid && drainDiaGuard.error) {
      errors.push(drainDiaGuard.error);
    }

    if (rawDrainQty < 1 || rawDrainQty > 4) {
      errors.push({
        code: 'HOLE_QTY_OUT_OF_RANGE',
        severity: 'error',
        field: 'drainQty',
        message: `Quantidade de drenos (${rawDrainQty}) deve estar entre 1 e 4.`,
      });
    }

    // Fileiras de dreno parametrizadas por distância ENTRE CENTROS; a distância
    // à borda vira residual informativo.
    const minDrainMargin = Math.max(10, Math.ceil(rawDrainDia / 2));
    const drainResidual = (L - rawDrainSpacing) / 2;
    let drainSpacingValid = true;
    if (drainResidual < minDrainMargin) {
      drainSpacingValid = false;
      errors.push({
        code: 'HOLE_MARGIN_EXCEEDS_SPACE',
        severity: 'error',
        field: 'drainRowSpacing',
        message: `Espaçamento das fileiras de dreno (${rawDrainSpacing.toFixed(1)}mm) excede o espaço: a margem residual (${drainResidual.toFixed(1)}mm) fica abaixo do mínimo (${minDrainMargin}mm) em Face Menor (B) - Fundo.`,
      });
    }

    // Só desenha os drenos se as validações forem válidas
    const drainValid = drainDiaGuard.isValid && drainSpacingValid && rawDrainQty >= 1 && rawDrainQty <= 4;
    if (drainValid) {
      const drainDia = rawDrainDia;
      const drainQty = rawDrainQty;
      const safeW = Math.max(drainDia + 4, faceFlatW - 2 * drainDia);
      const yPositions = [-rawDrainSpacing / 2, rawDrainSpacing / 2];

      yPositions.forEach((yPos) => {
        for (let i = 0; i < drainQty; i++) {
          let xOffset = 0;
          if (drainQty === 2) {
            xOffset = (i === 0 ? -1 : 1) * (safeW * 0.25);
          } else if (drainQty > 2) {
            const step = safeW / (drainQty - 1);
            xOffset = -safeW / 2 + i * step;
          }
          const xHole = faceCenterX + xOffset;

          circles.push({
            type: 'circle',
            center: { x: xHole, y: yPos },
            radius: drainDia / 2,
            layer: 'CUT',
          });
          piercingCount++;
        }
      });

      // Cotas de dreno: espaçamento entre fileiras (c/c) + margem residual (ref).
      cotas.push({
        type: 'linear',
        start: { x: faceCenterX, y: -rawDrainSpacing / 2 },
        end: { x: faceCenterX, y: rawDrainSpacing / 2 },
        label: `fileiras ${rawDrainSpacing.toFixed(1)} mm (c/c)`,
        valueMm: rawDrainSpacing,
        orientation: 'vertical',
        offset: -16,
      });
      if (drainResidual > 0) {
        cotas.push({
          type: 'linear',
          start: { x: faceCenterX, y: -L / 2 },
          end: { x: faceCenterX, y: -rawDrainSpacing / 2 },
          label: `borda ${drainResidual.toFixed(1)} mm (ref)`,
          valueMm: drainResidual,
          orientation: 'vertical',
          offset: -16,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // FURAÇÕES: FUROS DE FIXAÇÃO / AMARRAÇÃO DE CABO DE AÇO
  // -----------------------------------------------------------------------
  const hasFixing = (params.holesFixing ?? 0) !== 0;
  if (hasFixing) {
    const rawFixingFace = Math.round(params.fixingFace ?? 0); // 0=Face B, 1=Face A
    const rawFixingQty = Math.round(params.fixingQty ?? 2);
    const rawFixingDia = params.fixingDiameter ?? 10.0;
    const rawFixingPitch = params.fixingPitch ?? 100;
    const isOblong = (params.fixingOblong ?? 0) !== 0;
    const rawSlotLen = params.fixingSlotLength ?? 20;

    const targetFaceFlatW = rawFixingFace === 0 ? l3 : l2;
    const faceName = rawFixingFace === 0 ? 'Face Menor (B)' : 'Face Maior (A)';

    // 1. Diâmetro do furo
    const fixingDiaGuard = guardHoleDiameter({
      requestedDiameter: rawFixingDia,
      maxAvailableDiameter: Math.max(4.0, targetFaceFlatW - 2),
      minDiameter: 4,
      maxAllowedDiameter: 25,
      field: 'fixingDiameter',
      locationLabel: faceName,
    });
    if (!fixingDiaGuard.isValid && fixingDiaGuard.error) {
      errors.push(fixingDiaGuard.error);
    }

    // 2. Quantidade de furos
    if (rawFixingQty < 1 || rawFixingQty > 10) {
      errors.push({
        code: 'HOLE_QTY_OUT_OF_RANGE',
        severity: 'error',
        field: 'fixingQty',
        message: `Quantidade de furos de fixação (${rawFixingQty}) deve estar entre 1 e 10.`,
      });
    }

    const effDia = fixingDiaGuard.diameter;
    const spanY = isOblong ? Math.max(rawSlotLen, effDia + 2) : effDia;

    // 3. Passo entre centros (driver) + margem residual (informativa)
    const minFixingMargin = Math.max(10, Math.ceil(spanY / 2));
    const fixingSpan = rawFixingQty > 1 ? (rawFixingQty - 1) * rawFixingPitch : 0;
    const fixingResidual = (L - fixingSpan) / 2;
    let fixingPitchValid = true;
    if (rawFixingQty > 1) {
      if (rawFixingPitch < spanY + 2) {
        fixingPitchValid = false;
        errors.push({
          code: 'HOLE_OVERLAP',
          severity: 'error',
          field: 'fixingPitch',
          message: `Passo de fixação (${rawFixingPitch.toFixed(1)}mm) menor que o mínimo seguro (${(spanY + 2).toFixed(1)}mm): os furos colidiriam.`,
        });
      }
      if (fixingResidual < minFixingMargin) {
        fixingPitchValid = false;
        errors.push({
          code: 'HOLE_MARGIN_EXCEEDS_SPACE',
          severity: 'error',
          field: 'fixingPitch',
          message: `Passo de fixação (${rawFixingPitch.toFixed(1)}mm) excede o espaço: a margem residual (${fixingResidual.toFixed(1)}mm) fica abaixo do mínimo (${minFixingMargin}mm) em ${faceName}.`,
        });
      }
    }

    // 4. Rasgo oblongo
    let slotGuard: SlotGuardResult = { isValid: true, length: effDia };
    if (isOblong) {
      const maxAvailableSlotLen = rawFixingQty > 1 ? rawFixingPitch - 0.01 : L - 0.02;
      slotGuard = guardSlotLength({
        requestedLength: rawSlotLen,
        holeDiameter: effDia,
        maxAvailableLength: Math.max(0, maxAvailableSlotLen),
        minLength: effDia + 2,
        maxAllowedLength: 60,
        field: 'fixingSlotLength',
        locationLabel: faceName,
      });
      if (!slotGuard.isValid && slotGuard.error) {
        errors.push(slotGuard.error);
      }
    }

    // Só desenha se todas as validações de fixação forem válidas
    const fixingValid = fixingDiaGuard.isValid && fixingPitchValid && slotGuard.isValid &&
      rawFixingQty >= 1 && rawFixingQty <= 10 && errors.every((e) => e.field !== 'fixingQty');

    if (fixingValid) {
      const fixingQty = rawFixingQty;
      const fixingDia = rawFixingDia;
      const slotLen = isOblong ? rawSlotLen : fixingDia;

      const targetCenterX = rawFixingFace === 0
        ? (b2Global + b3Global) / 2
        : (b1Global + b2Global) / 2;

      for (let i = 0; i < fixingQty; i++) {
        const yHole = fixingQty === 1 ? 0 : -fixingSpan / 2 + i * rawFixingPitch;

        if (isOblong) {
          const poly = createSlotPolyline(targetCenterX, yHole, slotLen, fixingDia, true);
          innerPolylines.push(poly);
        } else {
          circles.push({
            type: 'circle',
            center: { x: targetCenterX, y: yHole },
            radius: fixingDia / 2,
            layer: 'CUT',
          });
        }
        piercingCount++;
      }

      // Cotas de fixação: passo (c/c) + margem residual (ref).
      if (fixingQty > 1 && fixingResidual > 0) {
        const yFirst = -fixingSpan / 2;
        cotas.push({
          type: 'linear',
          start: { x: targetCenterX, y: yFirst },
          end: { x: targetCenterX, y: yFirst + rawFixingPitch },
          label: `passo ${rawFixingPitch.toFixed(1)} mm (c/c)`,
          valueMm: rawFixingPitch,
          orientation: 'vertical',
          offset: 16,
        });
        cotas.push({
          type: 'linear',
          start: { x: targetCenterX, y: -L / 2 },
          end: { x: targetCenterX, y: yFirst },
          label: `borda ${fixingResidual.toFixed(1)} mm (ref)`,
          valueMm: fixingResidual,
          orientation: 'vertical',
          offset: 16,
        });
      }
    }
  }

  // Cotas principais do blank desenvolvido
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
