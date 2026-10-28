// DXFAST :: Orcamento consolidado do carrinho (lote de pecas variadas)
// Agrupa os itens por espessura (uma chapa so comporta uma espessura), aninha cada
// grupo com o nester heterogeneo (multiNest), e soma material, corte, dobra e
// margem. Conservador: usa a contagem de chapas do nester (que nunca superestima
// o aproveitamento). Proibido o caractere traco-longo em qualquer string.

import { GeometryResult, Point2D } from '../types/cad';
import { CuttingMachineConfig, BendingMachineConfig, SheetStockConfig, MaterialConfig } from '../types/admin';
import { resolveCutParams } from '../data/store/cuttingMath';
import { multiNest, NestPart, NestSheet } from './multiNest';
import { tessellatePart } from '../components/quote/partOutline';

export interface CartItem {
  id: string;
  name: string;
  geometry: GeometryResult;
  thicknessMm: number;
  qty: number;
  // Projeto parametrico que gerou a peca (quando nao for DXF importado), para
  // permitir reabrir e editar o item no configurador.
  design?: { templateId: string; params: Record<string, number>; features: Record<string, any> };
}

export interface CartGroupResult {
  thicknessMm: number;
  sheet: SheetStockConfig | null;
  sheetsNeeded: number;
  nestSheets: NestSheet[]; // leiaute de cada chapa (para preview)
  outerByKey: Record<string, { outer: Point2D[][]; w: number; h: number }>; // silhueta por item
  totalParts: number;
  materialCost: number;
  blockedReason?: string;
  // Peso e aproveitamento (para frete e analise de sucata)
  orderWeightKg: number;      // peso das pecas do grupo (o que o cliente recebe)
  sheetsWeightKg: number;     // peso das chapas compradas no grupo
  scrapKg: number;            // sucata (chapas menos pecas)
  scrapPercent: number;       // sucata em % do peso das chapas
  utilizationPercent: number; // aproveitamento de area das chapas
}

export interface CartQuoteResult {
  blocked: boolean;
  reason?: string;
  groups: CartGroupResult[];
  totalSheets: number;
  materialCost: number;
  cuttingCost: number;
  bendingCost: number;
  setupCost: number;
  subtotal: number; // antes da margem
  marginPercent: number;
  total: number;
  totalParts: number;
  orderWeightKg: number; // peso total das pecas do lote (frete)
  scrapKg: number;       // sucata total estimada
}

export interface CartQuoteInput {
  items: CartItem[];
  cuttingMachine: CuttingMachineConfig | null;
  bendingMachine: BendingMachineConfig | null;
  sheets: SheetStockConfig[];
  materials: MaterialConfig[];
  marginPercent: number;
  gapMm: number;
  // Chapa escolhida manualmente por espessura (chave = espessura arredondada),
  // sobrepoe a escolha automatica quando ha mais de uma chapa para a espessura.
  sheetOverrides?: Record<number, string>;
}

function sheetPrice(sheet: SheetStockConfig, thicknessMm: number, materialDensity?: number): number {
  if (sheet.pricePerSheet && sheet.pricePerSheet > 0) return sheet.pricePerSheet;
  if (sheet.pricePerKg && sheet.pricePerKg > 0) {
    const density = sheet.densityGPerCm3Snapshot || materialDensity || 7.85;
    const weightKg = (density * (sheet.widthMm * sheet.lengthMm * thicknessMm)) / 1e6;
    return weightKg * sheet.pricePerKg;
  }
  return 0;
}

// escolhe a chapa de estoque mais proxima da espessura
function pickSheet(sheets: SheetStockConfig[], thicknessMm: number): SheetStockConfig | null {
  if (sheets.length === 0) return null;
  const exact = sheets.find((s) => Math.abs(s.thicknessMm - thicknessMm) < 0.1);
  if (exact) return exact;
  let best = sheets[0];
  for (const s of sheets) {
    if (Math.abs(s.thicknessMm - thicknessMm) < Math.abs(best.thicknessMm - thicknessMm)) best = s;
  }
  return best;
}

const roundThk = (t: number) => Math.round(t * 10) / 10;

export function computeCartQuote(input: CartQuoteInput): CartQuoteResult {
  const { items, cuttingMachine, bendingMachine, sheets, materials, marginPercent, gapMm, sheetOverrides } = input;
  const empty: CartQuoteResult = {
    blocked: true, reason: '', groups: [], totalSheets: 0, materialCost: 0,
    cuttingCost: 0, bendingCost: 0, setupCost: 0, subtotal: 0, marginPercent, total: 0, totalParts: 0,
    orderWeightKg: 0, scrapKg: 0,
  };

  if (items.length === 0) return { ...empty, reason: 'O carrinho esta vazio.' };
  if (!cuttingMachine) return { ...empty, reason: 'Selecione uma maquina de corte.' };
  if (sheets.length === 0) return { ...empty, reason: 'Cadastre ao menos uma chapa de materia-prima.' };

  const matById = new Map(materials.map((m) => [m.id, m]));

  // agrupa por espessura
  const byThk = new Map<number, CartItem[]>();
  for (const it of items) {
    const k = roundThk(it.thicknessMm);
    if (!byThk.has(k)) byThk.set(k, []);
    byThk.get(k)!.push(it);
  }

  const groups: CartGroupResult[] = [];
  let totalSheets = 0, materialCost = 0, cuttingCost = 0, bendingCost = 0, totalParts = 0;
  let orderWeightKg = 0, scrapKg = 0;

  for (const [thk, grpItems] of Array.from(byThk.entries()).sort((a, b) => a[0] - b[0])) {
    const overrideId = sheetOverrides?.[thk];
    const sheet = (overrideId && sheets.find((s) => s.id === overrideId)) || pickSheet(sheets, thk);
    const cut = resolveCutParams(cuttingMachine, thk);
    const outerByKey: Record<string, { outer: Point2D[][]; w: number; h: number }> = {};
    const parts: NestPart[] = [];
    let grpParts = 0;

    for (const it of grpItems) {
      const outer = tessellatePart(it.geometry).outer;
      const w = it.geometry.metrics.blankWidthMm;
      const h = it.geometry.metrics.blankHeightMm;
      outerByKey[it.id] = { outer, w, h };
      for (let i = 0; i < it.qty; i++) {
        parts.push({ id: `${it.id}#${i}`, maskKey: it.id, outer, w, h });
      }
      grpParts += it.qty;
    }
    totalParts += grpParts;

    // Peso e area das pecas do grupo (densidade do material da chapa, ou 7.85).
    const matForWeight = sheet ? matById.get(sheet.materialId) : undefined;
    const density = (sheet?.densityGPerCm3Snapshot) || matForWeight?.densityGPerCm3 || 7.85;
    let groupPartsWeight = 0, groupPartsArea = 0;
    for (const it of grpItems) {
      const m = it.geometry.metrics;
      const net = m.netAreaMm2 || (m.blankWidthMm * m.blankHeightMm);
      groupPartsArea += net * it.qty;
      groupPartsWeight += (net * it.thicknessMm * density / 1e6) * it.qty;
    }

    let blockedReason: string | undefined;
    let sheetsNeeded = 0;
    let nestSheets: NestSheet[] = [];
    let grpMaterial = 0;

    if (!sheet) {
      blockedReason = 'Sem chapa cadastrada para esta espessura.';
    } else {
      const res = multiNest(sheet.widthMm, sheet.lengthMm, gapMm, parts);
      nestSheets = res.sheets;
      sheetsNeeded = res.sheets.length;
      if (res.unplaced.length > 0) {
        blockedReason = `${res.unplaced.length} peca(s) nao cabem na chapa de ${sheet.widthMm}x${sheet.lengthMm} mm.`;
      }
      const mat = matById.get(sheet.materialId);
      grpMaterial = sheetsNeeded * sheetPrice(sheet, thk, mat?.densityGPerCm3);
      materialCost += grpMaterial;
      totalSheets += sheetsNeeded;
    }

    // corte e dobra por peca (independe do nesting)
    if (cut) {
      for (const it of grpItems) {
        const m = it.geometry.metrics;
        const cutTimeMin = m.cutLengthMm / cut.speedMmPerMin + (m.piercingCount * cut.pierceTimeSec) / 60;
        cuttingCost += (cutTimeMin / 60) * cuttingMachine.hourlyRateBrl * it.qty;
        if (m.bendCount > 0 && bendingMachine) {
          const bendSec = m.bendCount * (bendingMachine.cycleTimeSecPerBend || 0);
          bendingCost += (bendSec / 3600) * bendingMachine.hourlyRateBrl * it.qty;
        }
      }
    } else if (!blockedReason) {
      blockedReason = `Espessura ${thk} mm fora das faixas de corte da maquina.`;
    }

    // Peso das chapas, sucata e aproveitamento do grupo.
    let sheetsWeightKg = 0, groupScrapKg = 0, utilizationPercent = 0, scrapPercent = 0;
    if (sheet && sheetsNeeded > 0) {
      const oneSheetKg = density * sheet.widthMm * sheet.lengthMm * thk / 1e6;
      sheetsWeightKg = oneSheetKg * sheetsNeeded;
      groupScrapKg = Math.max(0, sheetsWeightKg - groupPartsWeight);
      scrapPercent = sheetsWeightKg > 0 ? (groupScrapKg / sheetsWeightKg) * 100 : 0;
      const sheetsArea = sheet.widthMm * sheet.lengthMm * sheetsNeeded;
      utilizationPercent = sheetsArea > 0 ? (groupPartsArea / sheetsArea) * 100 : 0;
    }
    orderWeightKg += groupPartsWeight;
    scrapKg += groupScrapKg;

    groups.push({
      thicknessMm: thk, sheet, sheetsNeeded, nestSheets, outerByKey,
      totalParts: grpParts, materialCost: grpMaterial, blockedReason,
      orderWeightKg: groupPartsWeight, sheetsWeightKg, scrapKg: groupScrapKg, scrapPercent, utilizationPercent,
    });
  }

  // setup: uma vez por maquina/lote
  const cutSetup = (cuttingMachine.setupTimeMinPerJob / 60) * cuttingMachine.hourlyRateBrl;
  const hasBends = items.some((it) => (it.geometry.metrics.bendCount || 0) > 0);
  const bendSetup = hasBends && bendingMachine ? (bendingMachine.setupTimeMinPerJob / 60) * bendingMachine.hourlyRateBrl : 0;
  const setupCost = cutSetup + bendSetup;

  const subtotal = materialCost + cuttingCost + bendingCost + setupCost;
  const safeMargin = Math.max(0, marginPercent || 0);
  const total = subtotal * (1 + safeMargin / 100);

  const anyBlocked = groups.some((g) => g.blockedReason);
  return {
    blocked: false,
    reason: anyBlocked ? 'Alguns grupos tem avisos (veja abaixo).' : undefined,
    groups, totalSheets, materialCost, cuttingCost, bendingCost, setupCost,
    subtotal, marginPercent: safeMargin, total, totalParts,
    orderWeightKg, scrapKg,
  };
}
