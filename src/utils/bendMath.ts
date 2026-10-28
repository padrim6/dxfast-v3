/**
 * Industrial Sheet Metal Bending Mathematics Engine (Cálculo de Desdobramento e Dedução de Dobra)
 */

export interface BendCalculationResult {
  thicknessMm: number;
  internalRadiusMm: number;
  kFactor: number;
  bendAngleDeg: number;
  setbackMm: number;
  bendAllowanceMm: number;
  bendDeductionMm: number;
  formulaExplanation: string;
  warnings?: string[];
}

/**
 * Calculates industrial sheet unfolding parameters
 * @param thicknessMm Espessura da chapa (e / T) em mm
 * @param internalRadiusMm Raio interno de dobra (Ri) em mm
 * @param kFactor Fator K da linha neutra (0.2 a 0.8, padrão 0.44)
 * @param bendAngleDeg Ângulo de dobra em graus (padrão 90°)
 */
export function calculateBendParameters(
  thicknessMm: number,
  internalRadiusMm: number,
  kFactor: number = 0.44,
  bendAngleDeg: number = 90
): BendCalculationResult {
  const warnings: string[] = [];

  if (kFactor < 0.2 || kFactor > 0.8) {
    warnings.push(
      `Fator K (${kFactor}) fora do intervalo físico recomendado [0.20, 0.80]. Valor ajustado para ${Math.min(0.8, Math.max(0.2, kFactor))}.`
    );
  }
  if (bendAngleDeg < 1 || bendAngleDeg > 179) {
    warnings.push(
      `Ângulo de dobra (${bendAngleDeg}°) fora do intervalo geométrico permitido [1°, 179°]. Valor ajustado para ${Math.min(179, Math.max(1, bendAngleDeg))}°.`
    );
  }
  if (thicknessMm < 0.1) {
    warnings.push(`Espessura da chapa (${thicknessMm}mm) muito baixa. Valor ajustado para 0.1mm.`);
  }
  if (internalRadiusMm < 0.1) {
    warnings.push(`Raio interno de dobra (${internalRadiusMm}mm) muito baixo. Valor ajustado para 0.1mm.`);
  }

  const T = Math.max(0.1, thicknessMm);
  const Ri = Math.max(0.1, internalRadiusMm);
  const K = Math.min(0.8, Math.max(0.2, kFactor));
  const angle = Math.min(179, Math.max(1, bendAngleDeg));

  const angleRad = (angle * Math.PI) / 180;
  const halfAngleRad = (angleRad / 2);

  // Setback (SB) = tan(alpha / 2) * (Ri + T)
  const setbackMm = Math.tan(halfAngleRad) * (Ri + T);

  // Bend Allowance (BA) = (PI / 180) * alpha * (Ri + K * T)
  const bendAllowanceMm = (Math.PI / 180) * angle * (Ri + K * T);

  // Bend Deduction (BD) = 2 * Setback - BA
  const bendDeductionMm = 2 * setbackMm - bendAllowanceMm;

  const formulaExplanation = `Para e=${T.toFixed(2)}mm, Ri=${Ri.toFixed(2)}mm, K=${K.toFixed(2)} e Ângulo=${angle}°:
• Setback (SB) = tan(${angle / 2}°) × (${Ri} + ${T}) = ${setbackMm.toFixed(3)} mm
• Bend Allowance (BA) = (π/180) × ${angle}° × (${Ri} + ${K} × ${T}) = ${bendAllowanceMm.toFixed(3)} mm
• Dedução de Dobra (BD) = 2 × SB - BA = ${bendDeductionMm.toFixed(3)} mm por dobra.`;

  return {
    thicknessMm: T,
    internalRadiusMm: Ri,
    kFactor: K,
    bendAngleDeg: angle,
    setbackMm: Number(setbackMm.toFixed(4)),
    bendAllowanceMm: Number(bendAllowanceMm.toFixed(4)),
    bendDeductionMm: Number(bendDeductionMm.toFixed(4)),
    formulaExplanation,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Calculates blank developed width for profile sections given outer dimensions and bend parameters
 */
export function calculateProfileBlank(
  flangesMm: number[],
  bendParams: BendCalculationResult
): {
  totalBlankWidthMm: number;
  bendPositionsX: number[];
  faceWidthsBlankMm: number[];
} {
  const numBends = flangesMm.length - 1;
  if (numBends <= 0) {
    return {
      totalBlankWidthMm: flangesMm[0] || 0,
      bendPositionsX: [],
      faceWidthsBlankMm: [flangesMm[0] || 0],
    };
  }

  const { setbackMm, bendAllowanceMm, bendDeductionMm } = bendParams;

  // Face blank widths:
  // First face: A - SB + (BA / 2)
  // Middle faces: B - 2*SB + BA
  // Last face: C - SB + (BA / 2)
  const faceWidthsBlankMm: number[] = [];
  const bendPositionsX: number[] = [];

  let currentX = 0;

  for (let i = 0; i < flangesMm.length; i++) {
    const nominal = flangesMm[i];
    let faceBlank: number;

    if (i === 0 || i === flangesMm.length - 1) {
      // First or last flange (one bend attached)
      faceBlank = nominal - setbackMm + bendAllowanceMm / 2;
    } else {
      // Intermediate flange (two bends attached)
      faceBlank = nominal - 2 * setbackMm + bendAllowanceMm;
    }

    faceWidthsBlankMm.push(Number(faceBlank.toFixed(4)));

    if (i > 0) {
      // Bend line location is between face (i-1) and face (i)
      bendPositionsX.push(Number(currentX.toFixed(4)));
    }

    currentX += faceBlank;
  }

  const totalBlankWidthMm = Number(
    faceWidthsBlankMm.reduce((a, b) => a + b, 0).toFixed(4)
  );

  return {
    totalBlankWidthMm,
    bendPositionsX,
    faceWidthsBlankMm,
  };
}
