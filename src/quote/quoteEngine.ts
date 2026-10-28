// DXFAST :: Quotation Engine
// Pure calculation engine consuming geometry metrics and administrative shop floor configs.
// Outside src/engine/, zero side-effects, strictly NO em-dash in strings.

import { QuoteInput, QuoteOutcome } from './quoteTypes';
import { resolveCutParams } from '../data/store/cuttingMath';
import { nestShape } from './nesting';

// Reexporta para compatibilidade com quem importava daqui. O aninhamento real
// (com mistura de orientacoes via corte guilhotinado) vive em ./nesting.
export { piecesPerSheet } from './nesting';

/**
 * Pure function computing part and lot quote.
 * Returns QuoteResult on success, or { blocked: true, reason: string } on honest validation block.
 */
export function computeQuote(input: QuoteInput): QuoteOutcome {
  const {
    metrics,
    thicknessMm,
    cuttingMachine,
    bendingMachine,
    sheet,
    materialDensityGPerCm3,
    quantity,
    marginPercent,
    gapMm = 5,
    hasGeometryErrors = false,
    partOuterLoops,
    precomputedNesting,
  } = input;

  // 1. Bloqueio por inconsistência geométrica
  if (hasGeometryErrors) {
    return {
      blocked: true,
      reason: 'Corrija as inconsistências geométricas antes de orçar.',
    };
  }

  // 2. Validação de quantidade básica
  if (!quantity || quantity < 1) {
    return {
      blocked: true,
      reason: 'A quantidade do lote deve ser no mínimo 1 peça.',
    };
  }

  // 3. Validação de máquina de corte
  if (!cuttingMachine) {
    return {
      blocked: true,
      reason: 'Selecione uma máquina de corte cadastrada.',
    };
  }

  // 4. Resolução cinemática de corte (linear interpolation)
  const cutParams = resolveCutParams(cuttingMachine, thicknessMm);
  if (!cutParams) {
    return {
      blocked: true,
      reason: `A espessura de ${thicknessMm} mm está fora das faixas de corte configuradas para a máquina "${cuttingMachine.name}".`,
    };
  }

  // 5. Validação de máquina de dobra se bendCount > 0
  const bendCount = metrics.bendCount || 0;
  if (bendCount > 0 && !bendingMachine) {
    return {
      blocked: true,
      reason: `Esta peça possui ${bendCount} dobra(s). Selecione uma prensa dobradeira CNC cadastrada.`,
    };
  }

  // 6. Validação de chapa selecionada
  if (!sheet) {
    return {
      blocked: true,
      reason: 'Selecione uma chapa de matéria-prima em estoque.',
    };
  }

  const partWmm = metrics.blankWidthMm;
  const partHmm = metrics.blankHeightMm;
  const sheetWmm = sheet.widthMm;
  const sheetLmm = sheet.lengthMm;

  // 7. Aninhamento real (faixas alinhadas + encaixe aos pares quando compensa) e
  //    capacidade física da chapa. O packer nunca super-estima.
  const nesting = precomputedNesting ?? nestShape(sheetWmm, sheetLmm, partWmm, partHmm, gapMm, partOuterLoops);
  const pieces = nesting.count;
  if (pieces <= 0) {
    return {
      blocked: true,
      reason: `As dimensões do blank desdobrado (${Math.round(partWmm)} x ${Math.round(partHmm)} mm) excedem as dimensões da chapa selecionada (${sheetWmm} x ${sheetLmm} mm).`,
    };
  }

  // Bloco MATERIAL
  const density = sheet.densityGPerCm3Snapshot || materialDensityGPerCm3 || 7.85;
  const sheetWeightKg = (density * (sheetWmm * sheetLmm * thicknessMm)) / 1e6;

  let effectiveSheetPrice: number;
  if (sheet.pricePerSheet !== undefined && sheet.pricePerSheet > 0) {
    effectiveSheetPrice = sheet.pricePerSheet;
  } else if (sheet.pricePerKg !== undefined && sheet.pricePerKg > 0) {
    effectiveSheetPrice = sheetWeightKg * sheet.pricePerKg;
  } else {
    effectiveSheetPrice = 0;
  }

  const materialCostPerPiece = effectiveSheetPrice / pieces;
  const sheetsNeeded = Math.ceil(quantity / pieces);
  const sheetUtilizationPercent = ((pieces * partWmm * partHmm) / (sheetWmm * sheetLmm)) * 100;

  // Bloco CORTE
  const cutLengthMm = metrics.cutLengthMm || 0;
  const piercingCount = metrics.piercingCount || 0;
  const { speedMmPerMin, pierceTimeSec } = cutParams;

  const cutTimeMinPerPiece = cutLengthMm / speedMmPerMin + (piercingCount * pierceTimeSec) / 60;
  const cutCostPerPiece = (cutTimeMinPerPiece / 60) * cuttingMachine.hourlyRateBrl;
  const cutSetupTimeMin = cuttingMachine.setupTimeMinPerJob || 0;
  const cutSetupLotCost = (cutSetupTimeMin / 60) * cuttingMachine.hourlyRateBrl;

  // Bloco DOBRA
  let bendTimeSecPerPiece = 0;
  let bendCostPerPiece = 0;
  let bendSetupLotCost = 0;

  if (bendCount > 0 && bendingMachine) {
    bendTimeSecPerPiece = bendCount * (bendingMachine.cycleTimeSecPerBend || 0);
    bendCostPerPiece = (bendTimeSecPerPiece / 3600) * bendingMachine.hourlyRateBrl;
    const bendSetupTimeMin = bendingMachine.setupTimeMinPerJob || 0;
    bendSetupLotCost = (bendSetupTimeMin / 60) * bendingMachine.hourlyRateBrl;
  }

  // Bloco OVERHEAD / MARGEM / LOTE
  const variableCostPerPiece = materialCostPerPiece + cutCostPerPiece + bendCostPerPiece;
  const fixedCostPerLot = cutSetupLotCost + bendSetupLotCost;
  const unitBeforeMargin = variableCostPerPiece + fixedCostPerLot / quantity;
  const safeMargin = Math.max(0, marginPercent || 0);
  const unitPrice = unitBeforeMargin * (1 + safeMargin / 100);
  const totalPrice = unitPrice * quantity;

  // Aviso não-bloqueante se a espessura da chapa divergir da espessura do modelo
  let thicknessMismatchWarning: string | undefined = undefined;
  if (Math.abs(sheet.thicknessMm - thicknessMm) > 0.001) {
    thicknessMismatchWarning = `A chapa selecionada possui espessura de ${sheet.thicknessMm} mm, enquanto o modelo paramétrico está configurado com ${thicknessMm} mm.`;
  }

  return {
    blocked: false,
    material: {
      piecesPerSheet: pieces,
      sheetsNeeded,
      sheetWeightKg,
      effectiveSheetPrice,
      materialCostPerPiece,
      sheetUtilizationPercent,
      sheetWidthMm: sheetWmm,
      sheetLengthMm: sheetLmm,
      partWidthMm: partWmm,
      partHeightMm: partHmm,
      gapMm,
      placements: nesting.placements,
    },
    cutting: {
      speedMmPerMin,
      pierceTimeSec,
      cutTimeMinPerPiece,
      cutCostPerPiece,
      cutSetupLotCost,
    },
    bending: {
      bendCount,
      bendTimeSecPerPiece,
      bendCostPerPiece,
      bendSetupLotCost,
    },
    variableCostPerPiece,
    fixedCostPerLot,
    unitBeforeMargin,
    unitPrice,
    totalPrice,
    quantity,
    marginPercent: safeMargin,
    thicknessMismatchWarning,
  };
}
