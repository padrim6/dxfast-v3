import { FeatureId } from '../../types/cad';

export interface FeatureParamConfig {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface FeatureMetaConfig {
  name: string;
  description: string;
  params: FeatureParamConfig[];
}

export const FEATURE_METADATA: Record<FeatureId, FeatureMetaConfig> = {
  fillet: {
    name: 'Cantos Arredondados (Raio R)',
    description: 'Raios concordantes nos 4 cantos externos',
    params: [
      { key: 'radius', label: 'Raio (R)', unit: 'mm', min: 1, max: 150, step: 1, default: 10 },
    ],
  },
  chamfer: {
    name: 'Chanfros Angulares',
    description: 'Chanfro 45° nos vértices',
    params: [
      { key: 'size', label: 'Tamanho (C)', unit: 'mm', min: 1, max: 150, step: 1, default: 10 },
    ],
  },
  cornerHoles: {
    name: '4 Furos nos Cantos',
    description: 'Furação de fixação nos 4 vértices',
    params: [
      { key: 'diameter', label: 'Diâmetro (Ø)', unit: 'mm', min: 2, max: 100, step: 1, default: 12 },
      { key: 'gaugeX', label: 'Entre Centros X (c/c)', unit: 'mm', min: 10, max: 3000, step: 1, default: 200 },
      { key: 'gaugeY', label: 'Entre Centros Y (c/c)', unit: 'mm', min: 10, max: 3000, step: 1, default: 140 },
    ],
  },
  centerHole: {
    name: 'Furo Central Passante',
    description: 'Abertura circular central',
    params: [
      { key: 'diameter', label: 'Diâmetro (Ø)', unit: 'mm', min: 2, max: 1000, step: 1, default: 50 },
    ],
  },
  slottedHoles: {
    name: 'Rasgos Oblongos (Slots)',
    description: 'Rasgos para base de motor, esticadores e ajustes',
    params: [
      { key: 'length', label: 'Comprimento (L)', unit: 'mm', min: 10, max: 1000, step: 5, default: 40 },
      { key: 'width', label: 'Largura (Ø)', unit: 'mm', min: 3, max: 150, step: 1, default: 14 },
      { key: 'count', label: 'Quantidade', unit: 'un', min: 1, max: 12, step: 1, default: 4 },
      { key: 'spacingX', label: 'Distância X (C-C)', unit: 'mm', min: 10, max: 2000, step: 5, default: 120 },
      { key: 'spacingY', label: 'Distância Y (C-C)', unit: 'mm', min: 10, max: 2000, step: 5, default: 80 },
    ],
  },
  boltCircle: {
    name: 'Furação Circular (BCD)',
    description: 'Padrão circular de parafusos em coordenadas polares',
    params: [
      { key: 'bcd', label: 'Diâmetro BCD', unit: 'mm', min: 20, max: 2800, step: 5, default: 150 },
      { key: 'diameter', label: 'Diâmetro Furos (Ø)', unit: 'mm', min: 3, max: 100, step: 1, default: 14 },
      { key: 'count', label: 'Qtd. Furos', unit: 'un', min: 1, max: 48, step: 1, default: 4 },
      { key: 'startAngle', label: 'Ângulo Inicial', unit: 'deg', min: 0, max: 360, step: 5, default: 45 },
    ],
  },
  gridHoles: {
    name: 'Grelha de Furação (Matriz)',
    description: 'Matriz retangular para ventilação/alívio',
    params: [
      { key: 'rows', label: 'Linhas', unit: 'un', min: 1, max: 10, step: 1, default: 2 },
      { key: 'cols', label: 'Colunas', unit: 'un', min: 1, max: 10, step: 1, default: 2 },
      { key: 'diameter', label: 'Diâmetro (Ø)', unit: 'mm', min: 3, max: 50, step: 1, default: 10 },
      { key: 'pitchX', label: 'Passo X', unit: 'mm', min: 5, max: 100, step: 1, default: 25 },
      { key: 'pitchY', label: 'Passo Y', unit: 'mm', min: 5, max: 100, step: 1, default: 25 },
    ],
  },
  keyway: {
    name: 'Rasgo de Chaveta',
    description: 'Alojamento de chaveta no furo central (DIN 6885)',
    params: [
      { key: 'width', label: 'Largura (b)', unit: 'mm', min: 2, max: 50, step: 0.5, default: 10 },
      { key: 'depth', label: 'Profundidade (t2)', unit: 'mm', min: 1, max: 30, step: 0.5, default: 3.3 },
    ],
  },
  faceHoles: {
    name: 'Furação Modular nas Abas',
    description: 'Furos redondos ou rasgos nas faces do perfil',
    params: [
      { key: 'diameter', label: 'Diâmetro/Largura', unit: 'mm', min: 3, max: 50, step: 1, default: 14 },
      { key: 'slotLength', label: 'Compr. Rasgo (se slot)', unit: 'mm', min: 5, max: 100, step: 1, default: 28 },
      { key: 'count', label: 'Qtd. de Furos', unit: 'un', min: 1, max: 12, step: 1, default: 2 },
      { key: 'spacingX', label: 'Espaçamento', unit: 'mm', min: 10, max: 500, step: 5, default: 80 },
    ],
  },
};
