// DXFAST :: Camada de dados isolada (UNICO ponto do projeto que toca localStorage)
// API assincrona para que a troca futura por backend altere so este arquivo, sem
// mexer em nenhum componente. Chave raiz versionada. Seed na primeira execucao.
// Tolera localStorage indisponivel ou JSON corrompido sem derrubar o app.
// Proibido o caractere traco-longo em qualquer string.

import {
  AppAdminConfig,
  CompanyConfig,
  MaterialConfig,
  SheetStockConfig,
  CuttingMachineConfig,
  CuttingSpeedBand,
  BendingMachineConfig,
} from '../../types/admin';
import { cloneBaseMaterials } from '../baseMaterials';
import { defaultBandsFor } from './cuttingMath';

const STORAGE_KEY = 'dxfast.config.v1';
const SCHEMA_VERSION = 1;

let persistenceFailed = false;
let memoryState: AppAdminConfig | null = null; // espelho em memoria (fallback)

export function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignora e usa fallback
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function emptyCompany(): CompanyConfig {
  return {
    name: '',
    tradeName: '',
    cnpj: '',
    ie: '',
    phone: '',
    email: '',
    logoUrl: '',
    address: {},
    defaultQuoteValidityDays: 10,
    standardTerms: '',
    notes: '',
  };
}

// Padroes de fabrica: valores de partida para o orcamento funcionar de cara. Sao
// marcados como exemplo e devem ser calibrados (velocidades, custo/hora, preco).
const EXAMPLES_FLAG = 'dxfast.config.examples.v1';

function exampleSheets() {
  const sheet = (thicknessMm: number) => ({
    id: `seed-sheet-a36-${String(thicknessMm).replace('.', '_')}`,
    materialId: 'base-aco-a36',
    thicknessMm, widthMm: 1200, lengthMm: 3000,
    pricePerSheet: null, pricePerKg: null, densityGPerCm3Snapshot: 7.85,
    label: `Aco A36 ${thicknessMm}mm (exemplo)`,
  });
  return [sheet(1.2), sheet(2.0), sheet(3.0), sheet(4.75), sheet(6.35)];
}
function exampleCuttingMachines() {
  return [{ id: 'seed-laser', name: 'Laser (exemplo, calibrar)', type: 'laser' as const, hourlyRateBrl: 300, setupTimeMinPerJob: 10, bands: defaultBandsFor('laser') }];
}
function exampleBendingMachines() {
  return [{ id: 'seed-dobra', name: 'Dobradeira (exemplo, calibrar)', hourlyRateBrl: 200, setupTimeMinPerJob: 15, cycleTimeSecPerBend: 12, maxTonnageTons: 100 }];
}

function seedConfig(): AppAdminConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    company: emptyCompany(),
    materials: cloneBaseMaterials(),
    sheets: exampleSheets(),
    cuttingMachines: exampleCuttingMachines(),
    bendingMachines: exampleBendingMachines(),
  };
}

// Top-up unico para quem ja tinha config salva (de versao anterior) sem maquinas:
// injeta os exemplos uma vez, sem sobrescrever o que o usuario ja cadastrou.
function ensureExamples(state: AppAdminConfig): AppAdminConfig {
  try {
    if (typeof localStorage === 'undefined') return state;
    if (localStorage.getItem(EXAMPLES_FLAG)) return state;
    localStorage.setItem(EXAMPLES_FLAG, '1');
    let changed = false;
    const next = { ...state };
    if (state.cuttingMachines.length === 0) { next.cuttingMachines = exampleCuttingMachines(); changed = true; }
    if (state.bendingMachines.length === 0) { next.bendingMachines = exampleBendingMachines(); changed = true; }
    if (state.sheets.length === 0) { next.sheets = exampleSheets(); changed = true; }
    if (changed) { writeRaw(next); return next; }
    return state;
  } catch {
    return state;
  }
}

// ---------------------------------------------------------------------------
// Saneamento registro a registro. Config salva por versoes antigas pode ter
// registros parciais (ex.: maquina de corte sem "bands", material sem densidade).
// A UI acessa campos direto (m.bands.length, m.hourlyRateBrl.toFixed(...)), entao
// um registro malformado derrubaria a tela inteira. Aqui coagimos cada registro
// para uma forma valida ANTES de entregar ao app. Este arquivo e o unico ponto
// que le o estado persistido, logo e o lugar certo para curar dados antigos.
// ---------------------------------------------------------------------------
function num(v: any, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: any, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
const VALID_GROUPS = ['carbon_steel', 'stainless_steel', 'aluminum', 'copper_alloy', 'other'];

function sanitizeBand(b: any): CuttingSpeedBand {
  return {
    thicknessMinMm: num(b?.thicknessMinMm, 0),
    thicknessMaxMm: num(b?.thicknessMaxMm, 0),
    speedAtMinMmPerMin: num(b?.speedAtMinMmPerMin, 0),
    speedAtMaxMmPerMin: num(b?.speedAtMaxMmPerMin, 0),
    pierceAtMinSec: num(b?.pierceAtMinSec, 0),
    pierceAtMaxSec: num(b?.pierceAtMaxSec, 0),
  };
}
function sanitizeCuttingMachine(m: any): CuttingMachineConfig {
  const type: 'laser' | 'plasma' = m?.type === 'plasma' ? 'plasma' : 'laser';
  const bands = Array.isArray(m?.bands) && m.bands.length > 0 ? m.bands.map(sanitizeBand) : defaultBandsFor(type);
  return {
    id: str(m?.id) || genId(),
    name: str(m?.name),
    type,
    hourlyRateBrl: num(m?.hourlyRateBrl, 0),
    setupTimeMinPerJob: num(m?.setupTimeMinPerJob, 0),
    bands,
  };
}
function sanitizeBendingMachine(m: any): BendingMachineConfig {
  const out: BendingMachineConfig = {
    id: str(m?.id) || genId(),
    name: str(m?.name),
    hourlyRateBrl: num(m?.hourlyRateBrl, 0),
    setupTimeMinPerJob: num(m?.setupTimeMinPerJob, 0),
    cycleTimeSecPerBend: num(m?.cycleTimeSecPerBend, 0),
  };
  if (m?.maxTonnageTons != null && Number.isFinite(num(m.maxTonnageTons, NaN))) {
    out.maxTonnageTons = num(m.maxTonnageTons, 0);
  }
  return out;
}
function sanitizeMaterial(m: any): MaterialConfig {
  const price = m?.pricePerKg;
  return {
    id: str(m?.id) || genId(),
    name: str(m?.name),
    code: str(m?.code),
    group: VALID_GROUPS.includes(m?.group) ? m.group : 'other',
    densityGPerCm3: num(m?.densityGPerCm3, 7.85),
    pricePerKg: price == null ? null : num(price, 0),
    isBase: m?.isBase === true,
  };
}
function sanitizeSheet(s: any): SheetStockConfig {
  const perSheet = s?.pricePerSheet;
  const perKg = s?.pricePerKg;
  const out: SheetStockConfig = {
    id: str(s?.id) || genId(),
    materialId: str(s?.materialId),
    thicknessMm: num(s?.thicknessMm, 0),
    widthMm: num(s?.widthMm, 0),
    lengthMm: num(s?.lengthMm, 0),
    pricePerSheet: perSheet == null ? null : num(perSheet, 0),
    pricePerKg: perKg == null ? null : num(perKg, 0),
  };
  if (s?.densityGPerCm3Snapshot != null) out.densityGPerCm3Snapshot = num(s.densityGPerCm3Snapshot, 7.85);
  if (s?.label != null) out.label = str(s.label);
  return out;
}

function sanitizeArray<T>(raw: any, fn: (x: any) => T): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    try { out.push(fn(item)); } catch { /* descarta registro irrecuperavel */ }
  }
  return out;
}

// Normaliza um objeto possivelmente antigo/parcial para o schema atual.
function normalize(raw: any): AppAdminConfig {
  const base = seedConfig();
  if (!raw || typeof raw !== 'object') return base;
  const materials = sanitizeArray(raw.materials, sanitizeMaterial);
  return {
    schemaVersion: SCHEMA_VERSION,
    company: { ...base.company, ...(raw.company || {}), address: { ...(raw.company?.address || {}) } },
    materials: materials.length > 0 ? materials : base.materials,
    sheets: sanitizeArray(raw.sheets, sanitizeSheet),
    cuttingMachines: sanitizeArray(raw.cuttingMachines, sanitizeCuttingMachine),
    bendingMachines: sanitizeArray(raw.bendingMachines, sanitizeBendingMachine),
  };
}

function readRaw(): AppAdminConfig {
  if (memoryState) return memoryState;
  try {
    const txt = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!txt) {
      const seeded = seedConfig();
      memoryState = seeded;
      writeRaw(seeded); // grava o seed uma vez
      return seeded;
    }
    const parsed = JSON.parse(txt);
    memoryState = ensureExamples(normalize(parsed));
    return memoryState;
  } catch {
    persistenceFailed = true;
    memoryState = seedConfig();
    return memoryState;
  }
}

function writeRaw(state: AppAdminConfig): void {
  memoryState = state;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      persistenceFailed = false;
    } else {
      persistenceFailed = true;
    }
  } catch {
    persistenceFailed = true;
  }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = item;
    return copy;
  }
  return [...list, item];
}

// API publica (assincrona de proposito, mesmo com implementacao sincrona).
export const configStore = {
  hasPersistenceFailed(): boolean {
    return persistenceFailed;
  },

  async getConfig(): Promise<AppAdminConfig> {
    return readRaw();
  },

  // Empresa
  async getCompany(): Promise<CompanyConfig> {
    return readRaw().company;
  },
  async saveCompany(data: CompanyConfig): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, company: { ...data, address: { ...data.address } } });
  },

  // Materiais
  async listMaterials(): Promise<MaterialConfig[]> {
    return readRaw().materials;
  },
  async saveMaterial(m: MaterialConfig): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, materials: upsert(state.materials, m) });
  },
  async deleteMaterial(id: string): Promise<void> {
    const state = readRaw();
    // material base nao se apaga individualmente (so pelo reset)
    writeRaw({ ...state, materials: state.materials.filter((m) => m.id !== id || m.isBase) });
  },
  async resetMaterialsToBase(): Promise<MaterialConfig[]> {
    const state = readRaw();
    const custom = state.materials.filter((m) => !m.isBase);
    const next = [...cloneBaseMaterials(), ...custom];
    writeRaw({ ...state, materials: next });
    return next;
  },

  // Chapas
  async listSheets(): Promise<SheetStockConfig[]> {
    return readRaw().sheets;
  },
  async saveSheet(s: SheetStockConfig): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, sheets: upsert(state.sheets, s) });
  },
  async deleteSheet(id: string): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, sheets: state.sheets.filter((s) => s.id !== id) });
  },

  // Maquinas de corte
  async listCuttingMachines(): Promise<CuttingMachineConfig[]> {
    return readRaw().cuttingMachines;
  },
  async saveCuttingMachine(m: CuttingMachineConfig): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, cuttingMachines: upsert(state.cuttingMachines, m) });
  },
  async deleteCuttingMachine(id: string): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, cuttingMachines: state.cuttingMachines.filter((m) => m.id !== id) });
  },

  // Maquinas de dobra
  async listBendingMachines(): Promise<BendingMachineConfig[]> {
    return readRaw().bendingMachines;
  },
  async saveBendingMachine(m: BendingMachineConfig): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, bendingMachines: upsert(state.bendingMachines, m) });
  },
  async deleteBendingMachine(id: string): Promise<void> {
    const state = readRaw();
    writeRaw({ ...state, bendingMachines: state.bendingMachines.filter((m) => m.id !== id) });
  },

  // Backup / rede de seguranca
  async exportConfig(): Promise<string> {
    return JSON.stringify(readRaw(), null, 2);
  },
  async importConfig(json: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Arquivo invalido: nao e um objeto de configuracao.' };
      }
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        return {
          ok: false,
          error: `Versao de schema incompativel (esperado ${SCHEMA_VERSION}, recebido ${parsed.schemaVersion}).`,
        };
      }
      writeRaw(normalize(parsed));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Nao foi possivel ler o arquivo JSON.' };
    }
  },
};
