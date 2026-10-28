// DXFAST :: Presets de parametros por template (configuracoes nomeadas)
// Camada isolada na pasta data/store. Proibido o caractere traco-longo.

const KEY = 'dxfast.presets.v1';

export interface ParamPreset {
  id: string;
  name: string;
  params: Record<string, number>;
  features: Record<string, any>;
}

type PresetStoreData = Record<string, ParamPreset[]>; // templateId -> presets

function read(): PresetStoreData {
  try {
    if (typeof localStorage === 'undefined') return {};
    const txt = localStorage.getItem(KEY);
    return txt ? (JSON.parse(txt) as PresetStoreData) : {};
  } catch {
    return {};
  }
}

function write(data: PresetStoreData): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignora
  }
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fallback */ }
  return 'preset-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const presetStore = {
  listForTemplate(templateId: string): ParamPreset[] {
    return read()[templateId] || [];
  },
  save(templateId: string, name: string, params: Record<string, number>, features: Record<string, any>): ParamPreset {
    const data = read();
    const list = data[templateId] || [];
    const existingIdx = list.findIndex((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    const preset: ParamPreset = { id: existingIdx >= 0 ? list[existingIdx].id : genId(), name: name.trim(), params: { ...params }, features: JSON.parse(JSON.stringify(features)) };
    if (existingIdx >= 0) list[existingIdx] = preset; else list.push(preset);
    data[templateId] = list;
    write(data);
    return preset;
  },
  remove(templateId: string, id: string): void {
    const data = read();
    data[templateId] = (data[templateId] || []).filter((p) => p.id !== id);
    write(data);
  },
};
