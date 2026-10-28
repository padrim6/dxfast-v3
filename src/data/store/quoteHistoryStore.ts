// DXFAST :: Historico de orcamentos (propostas geradas)
// Guarda um registro por proposta emitida, com o necessario para reabrir.
// Camada isolada na pasta data/store. Proibido o caractere traco-longo.

import { CartItem } from '../../quote/cartQuote';

const KEY = 'dxfast.quotehistory.v1';
const MAX = 20;

export interface QuoteHistoryRecord {
  id: string;
  dateISO: string;
  kind: 'single' | 'cart';
  clientName?: string;
  total: number;
  itemCount: number;
  // Dados para reabrir
  single?: {
    design?: { templateId: string; params: Record<string, number>; features: Record<string, any> };
    partName: string;
    thicknessMm: number;
  };
  cart?: { items: CartItem[] };
}

function read(): QuoteHistoryRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const txt = localStorage.getItem(KEY);
    return txt ? (JSON.parse(txt) as QuoteHistoryRecord[]) : [];
  } catch {
    return [];
  }
}

function write(list: QuoteHistoryRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // armazenamento cheio: tenta de novo com metade dos registros
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.ceil(MAX / 2))));
    } catch { /* desiste em silencio */ }
  }
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallback */ }
  return 'hist-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const quoteHistoryStore = {
  list(): QuoteHistoryRecord[] {
    return read();
  },
  add(rec: Omit<QuoteHistoryRecord, 'id' | 'dateISO'>): QuoteHistoryRecord {
    const full: QuoteHistoryRecord = { ...rec, id: genId(), dateISO: new Date().toISOString() };
    const next = [full, ...read()].slice(0, MAX);
    write(next);
    return full;
  },
  remove(id: string): void {
    write(read().filter((r) => r.id !== id));
  },
  clear(): void {
    write([]);
  },
};
