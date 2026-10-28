// DXFAST :: Template sintetico para pecas importadas de DXF
// Uma peca importada nao tem parametros; mas os componentes (viewport, orcamento)
// esperam um TemplateDefinition. Este helper monta um minimo valido, marcado como
// chapa plana (flat_sheet), com todas as features desligadas e apenas a espessura.
// Proibido o caractere traco-longo em qualquer string.

import { TemplateDefinition, FeatureId, FeatureState } from '../types/cad';

export const IMPORTED_TEMPLATE_ID = 'imported_dxf';

const ALL_FEATURES: FeatureId[] = [
  'fillet', 'chamfer', 'cornerHoles', 'centerHole', 'slottedHoles',
  'boltCircle', 'gridHoles', 'keyway', 'faceHoles',
];

export function makeImportedTemplate(name: string, thicknessMm: number): TemplateDefinition {
  const defaultFeatures = {} as Record<FeatureId, FeatureState>;
  for (const f of ALL_FEATURES) defaultFeatures[f] = { enabled: false, params: {} };

  return {
    id: IMPORTED_TEMPLATE_ID,
    name: name || 'Peca Importada',
    category: 'flat_sheet',
    family: 'special',
    description: 'Peca importada de arquivo DXF (geometria livre).',
    iconName: 'FileInput',
    compatibleFeatures: [],
    baseParams: {
      thickness: { label: 'Espessura', unit: 'mm', min: 0.5, max: 50, step: 0.5, default: thicknessMm },
    },
    defaultParams: { thickness: thicknessMm },
    defaultFeatures,
  };
}
