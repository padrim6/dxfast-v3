// DXFAST :: Quotation Engine Types
// Data structures for inputs, calculations and breakdowns across material, cutting, bending and overhead.
// Strictly NO em-dash in any strings.

import { GeometryMetrics, Point2D } from '../types/cad';
import { CuttingMachineConfig, BendingMachineConfig, SheetStockConfig } from '../types/admin';
import { Placement } from './nesting';

export interface QuoteInput {
  metrics: GeometryMetrics;
  thicknessMm: number;
  cuttingMachine: CuttingMachineConfig;
  bendingMachine?: BendingMachineConfig | null;
  sheet: SheetStockConfig;
  materialDensityGPerCm3?: number;
  quantity: number; // >= 1
  marginPercent: number; // >= 0
  gapMm?: number; // default 5 mm
  hasGeometryErrors?: boolean;
  // Silhueta externa da peca (lacos locais normalizados a origem da bbox, y para
  // cima), usada no encaixe aos pares. Se ausente, usa so o aninhamento retangular.
  partOuterLoops?: Point2D[][];
  // Aninhamento ja calculado (reaproveitado para nao re-nestar quando so mudam
  // margem ou quantidade, que nao afetam o leiaute na chapa).
  precomputedNesting?: { count: number; placements: Placement[] };
}

export interface QuoteMaterialBreakdown {
  piecesPerSheet: number;
  sheetsNeeded: number;
  sheetWeightKg: number;
  effectiveSheetPrice: number;
  materialCostPerPiece: number;
  sheetUtilizationPercent: number;
  // Dados do aninhamento real (para o preview visual do leiaute na chapa).
  sheetWidthMm: number;
  sheetLengthMm: number;
  partWidthMm: number;
  partHeightMm: number;
  gapMm: number;
  placements: Placement[];
}

export interface QuoteCuttingBreakdown {
  speedMmPerMin: number;
  pierceTimeSec: number;
  cutTimeMinPerPiece: number;
  cutCostPerPiece: number;
  cutSetupLotCost: number;
}

export interface QuoteBendingBreakdown {
  bendCount: number;
  bendTimeSecPerPiece: number;
  bendCostPerPiece: number;
  bendSetupLotCost: number;
}

export interface QuoteResult {
  blocked: false;
  material: QuoteMaterialBreakdown;
  cutting: QuoteCuttingBreakdown;
  bending: QuoteBendingBreakdown;
  variableCostPerPiece: number;
  fixedCostPerLot: number;
  unitBeforeMargin: number;
  unitPrice: number;
  totalPrice: number;
  quantity: number;
  marginPercent: number;
  thicknessMismatchWarning?: string;
}

export interface QuoteBlocked {
  blocked: true;
  reason: string;
}

export type QuoteOutcome = QuoteResult | QuoteBlocked;
