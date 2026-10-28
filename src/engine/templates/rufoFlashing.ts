// DXFAST :: Solver RUFO COM PINGADEIRA (rufo_flashing)
// Perfil aberto de 3 faces e 2 dobras (aba de fixacao A, saia B, pingadeira C),
// com DUAS dobras de angulos distintos (bendAngle1, bendAngle2). A furacao de
// fixacao fica so na Face A, posicionada por entre centros (holePitch ao longo do
// comprimento L, holeGauge transversal a partir da borda longitudinal da aba).
// Fonte unica de verdade: as faces e dobras aqui definidas alimentam o 3D.
// Proibido o caractere traco-longo em qualquer string.

import { TemplateExecutionContext, TemplateGeometryOutput } from './types';
import { calculateBendParameters } from '../../utils/bendMath';
import { propagateBendWarnings, createRectangularContour, MIN_WALL_GAP } from '../helpers';
import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  BendLine,
  FaceSection,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';

export function solveRufoFlashing(
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

  const rawA = params.flangeA || 50;
  const rawB = params.flangeB || 120;
  const rawC = params.flangeC || 25;
  const L = Math.max(20, params.lengthL || 300);
  const Ri = params.innerRadius ?? 1.5;
  const K = params.kFactor ?? 0.44;
  const angle1 = params.bendAngle1 ?? 105;
  const angle2 = params.bendAngle2 ?? 90;

  const bp1 = calculateBendParameters(sheetThickness, Ri, K, angle1);
  const bp2 = calculateBendParameters(sheetThickness, Ri, K, angle2);
  propagateBendWarnings(bp1, warnings);
  propagateBendWarnings(bp2, warnings);

  const T = bp1.thicknessMm;
  const RiSafe = bp1.internalRadiusMm;
  const Ro = RiSafe + T;
  const osb1 = Math.tan(((bp1.bendAngleDeg / 2) * Math.PI) / 180) * Ro;
  const osb2 = Math.tan(((bp2.bendAngleDeg / 2) * Math.PI) / 180) * Ro;

  const minA = Math.ceil(osb1 + 2);
  const minB = Math.ceil(osb1 + osb2 + 4);
  const minC = Math.ceil(osb2 + 2);

  let fA = Math.max(minA, rawA);
  let fB = Math.max(minB, rawB);
  let fC = Math.max(minC, rawC);

  if (rawA < minA) warnings.push({ field: 'flangeA', message: `Aba de fixacao A ajustada para ${fA}mm para comportar a dobra 1 (Ri=${RiSafe}mm).`, type: 'correction' });
  if (rawB < minB) warnings.push({ field: 'flangeB', message: `Saia B ajustada para ${fB}mm para comportar as duas dobras (Ri=${RiSafe}mm).`, type: 'correction' });
  if (rawC < minC) warnings.push({ field: 'flangeC', message: `Pingadeira C ajustada para ${fC}mm para comportar a dobra 2 (Ri=${RiSafe}mm).`, type: 'correction' });

  // Desdobramento com DUAS dobras de angulos distintos (dedugao por dobra).
  const faceA_blank = fA - bp1.setbackMm + bp1.bendAllowanceMm / 2;
  const faceB_blank = fB - bp1.setbackMm - bp2.setbackMm + bp1.bendAllowanceMm / 2 + bp2.bendAllowanceMm / 2;
  const faceC_blank = fC - bp2.setbackMm + bp2.bendAllowanceMm / 2;
  const totalW = Number((faceA_blank + faceB_blank + faceC_blank).toFixed(4));
  const blankWidthMm = totalW;
  const blankHeightMm = L;

  outerPolylines.push(createRectangularContour(totalW, L, 0, 0));
  let piercingCount = 1;

  const b1Global = -totalW / 2 + faceA_blank;
  const b2Global = -totalW / 2 + faceA_blank + faceB_blank;
  const bendCount = 2;

  bendLines.push({
    id: 'bend_1', faceIndex: 0, label: `DOBRA 1 (${bp1.bendAngleDeg} graus | Ri=${RiSafe}mm)`,
    direction: 'DOWN', angleDeg: bp1.bendAngleDeg, radiusMm: RiSafe, kFactor: K,
    positionX: b1Global, startY: -L / 2, endY: L / 2, sheetThicknessMm: T,
    bendAllowanceMm: bp1.bendAllowanceMm, bendDeductionMm: bp1.bendDeductionMm, setbackMm: bp1.setbackMm,
  });
  bendLines.push({
    id: 'bend_2', faceIndex: 1, label: `DOBRA 2 (${bp2.bendAngleDeg} graus | Ri=${RiSafe}mm)`,
    direction: 'DOWN', angleDeg: bp2.bendAngleDeg, radiusMm: RiSafe, kFactor: K,
    positionX: b2Global, startY: -L / 2, endY: L / 2, sheetThicknessMm: T,
    bendAllowanceMm: bp2.bendAllowanceMm, bendDeductionMm: bp2.bendDeductionMm, setbackMm: bp2.setbackMm,
  });

  const faceSections: FaceSection[] = [
    { index: 0, name: 'Aba de Fixacao A', widthNominalMm: fA, widthBlankMm: Number(faceA_blank.toFixed(4)), startXBlankMm: -totalW / 2, endXBlankMm: b1Global, heightMm: L },
    { index: 1, name: 'Saia B', widthNominalMm: fB, widthBlankMm: Number(faceB_blank.toFixed(4)), startXBlankMm: b1Global, endXBlankMm: b2Global, heightMm: L },
    { index: 2, name: 'Pingadeira C', widthNominalMm: fC, widthBlankMm: Number(faceC_blank.toFixed(4)), startXBlankMm: b2Global, endXBlankMm: totalW / 2, heightMm: L },
  ];

  // Furacao de fixacao: so na Face A, entre centros ao longo do comprimento L.
  const holeDia = Math.max(1, params.holeDiameter || 6);
  const holeCount = Math.max(0, Math.round(params.holeCount ?? 4));
  const holePitch = Math.max(0, params.holePitch || 80);
  const holeGauge = Math.max(0, params.holeGauge || 20);
  const holeStart = Math.max(0, params.holeStartOffset || 30);
  const r = holeDia / 2;

  // Posicao transversal (blankX) da linha de furos, a partir da borda longitudinal
  // externa da aba (blankX = -totalW/2). Limite util: antes do setback da dobra 1.
  const holeBlankX = -totalW / 2 + holeGauge;
  const faceAUsableEnd = b1Global - bp1.setbackMm; // inicio da zona de dobra
  if (holeCount > 0) {
    if (holeGauge < r + MIN_WALL_GAP) {
      errors.push({ code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: 'holeGauge', message: `A linha de furos fica a ${holeGauge}mm da borda da aba, abaixo da parede minima. Aumente o gauge.` });
    }
    if (holeBlankX + r > faceAUsableEnd - MIN_WALL_GAP) {
      errors.push({ code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: 'holeGauge', message: `A linha de furos invade a zona da dobra 1. Reduza o gauge ou aumente a aba de fixacao.` });
    }
    const lastY = -L / 2 + holeStart + (holeCount - 1) * holePitch;
    if (holeStart < r + MIN_WALL_GAP) {
      errors.push({ code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: 'holeStartOffset', message: `O primeiro furo fica a menos de ${MIN_WALL_GAP}mm da extremidade. Aumente o deslocamento inicial.` });
    }
    if (lastY + r > L / 2 - MIN_WALL_GAP) {
      errors.push({ code: 'HOLE_OUTSIDE_CONTOUR', severity: 'error', field: 'holePitch', message: `A furacao ultrapassa o comprimento L. Reduza a quantidade, o entre centros ou o deslocamento inicial.` });
    }
  }

  for (let k = 0; k < holeCount; k++) {
    const hy = -L / 2 + holeStart + k * holePitch;
    circles.push({ type: 'circle', center: { x: holeBlankX, y: hy }, radius: r, layer: 'CUT' });
    piercingCount++;
  }

  // Cotas: largura total do blank, comprimento, entre centros (principal) e refs.
  cotas.push({ type: 'linear', start: { x: -totalW / 2, y: L / 2 }, end: { x: totalW / 2, y: L / 2 }, label: `${totalW.toFixed(1)} mm`, valueMm: totalW, orientation: 'horizontal', offset: 25 });
  cotas.push({ type: 'linear', start: { x: totalW / 2, y: -L / 2 }, end: { x: totalW / 2, y: L / 2 }, label: `${L.toFixed(1)} mm`, valueMm: L, orientation: 'vertical', offset: 25 });
  if (holeCount >= 2) {
    cotas.push({ type: 'linear', start: { x: holeBlankX, y: -L / 2 + holeStart }, end: { x: holeBlankX, y: -L / 2 + holeStart + holePitch }, label: `Entre centros ${holePitch} mm`, valueMm: holePitch, orientation: 'vertical', offset: 12 });
  }
  if (holeCount >= 1) {
    cotas.push({ type: 'linear', start: { x: -totalW / 2, y: -L / 2 + holeStart }, end: { x: holeBlankX, y: -L / 2 + holeStart }, label: `gauge: ${holeGauge} mm (ref)`, valueMm: holeGauge, orientation: 'horizontal', offset: 9 });
  }

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
    unfoldingMath: bp1,
  };
}
