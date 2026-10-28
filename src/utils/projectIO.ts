// Serialização de projeto DXFAST: salvar/abrir uma peça (modelo + parâmetros +
// features + nome) como arquivo .json portátil.
import { FeatureId, FeatureState } from '../types/cad';
import { downloadBlob } from './download';

const MAGIC = 'dxfast.project';
const VERSION = 1;

export interface DesignSnapshot {
  templateId: string;
  partName: string;
  params: Record<string, number>;
  features: Record<FeatureId, FeatureState>;
}

export interface ProjectFile {
  magic: string;
  version: number;
  savedAt: string;
  design: DesignSnapshot;
}

export function serializeDesign(design: DesignSnapshot): string {
  const file: ProjectFile = {
    magic: MAGIC,
    version: VERSION,
    savedAt: new Date().toISOString(),
    design,
  };
  return JSON.stringify(file, null, 2);
}

function safeName(name: string): string {
  const base = (name || 'projeto').trim().replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return base || 'projeto';
}

/** Dispara o download do projeto como .dxfast.json (com fallback em ambiente incorporado). */
export function exportDesign(design: DesignSnapshot): void {
  const json = serializeDesign(design);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  void downloadBlob(blob, `${safeName(design.partName)}.dxfast.json`, json);
}

/**
 * Lê e valida um projeto a partir do texto JSON. Lança Error com mensagem
 * amigável quando o arquivo é inválido.
 */
export function parseDesign(jsonText: string): DesignSnapshot {
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Arquivo inválido: não é um JSON válido.');
  }
  if (!data || data.magic !== MAGIC) {
    throw new Error('Arquivo inválido: não é um projeto DXFAST.');
  }
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new Error(`Versão de projeto não suportada (${data.version}).`);
  }
  const d = data.design;
  if (!d || typeof d.templateId !== 'string' || !d.params || !d.features) {
    throw new Error('Arquivo inválido: estrutura de projeto incompleta.');
  }
  return {
    templateId: d.templateId,
    partName: typeof d.partName === 'string' ? d.partName : 'Peça',
    params: { ...d.params },
    features: { ...d.features },
  };
}

/** Abre o seletor de arquivo e resolve com o projeto lido (ou rejeita com Error). */
export function pickProjectFile(): Promise<DesignSnapshot> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        reject(new Error('Nenhum arquivo selecionado.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parseDesign(String(reader.result || '')));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
      reader.readAsText(file);
    };
    input.click();
  });
}
