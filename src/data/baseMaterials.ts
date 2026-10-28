// DXFAST :: Biblioteca base de materiais (seed da primeira execucao)
// Densidades em g/cm3, valores tecnicos. Todos com isBase true e pricePerKg null
// (o usuario preenche o preco depois). Proibido o caractere traco-longo.

import { MaterialConfig } from '../types/admin';

function baseMaterial(
  id: string,
  name: string,
  code: string,
  group: MaterialConfig['group'],
  densityGPerCm3: number
): MaterialConfig {
  return { id, name, code, group, densityGPerCm3, pricePerKg: null, isBase: true };
}

// Ids estaveis e deterministicos (prefixo base-) para o seed nao duplicar ao
// reexecutar e para o reset conseguir repor sem criar ids novos.
export const BASE_MATERIALS: MaterialConfig[] = [
  // Aco carbono
  baseMaterial('base-aco-1020', 'Aco Carbono 1020', '1020', 'carbon_steel', 7.85),
  baseMaterial('base-aco-a36', 'Aco ASTM A36', 'A36', 'carbon_steel', 7.85),
  baseMaterial('base-aco-galv', 'Aco Galvanizado', 'GALV', 'carbon_steel', 7.85),
  // Inox
  baseMaterial('base-inox-304', 'Inox 304', '304', 'stainless_steel', 8.0),
  baseMaterial('base-inox-316', 'Inox 316', '316', 'stainless_steel', 8.0),
  baseMaterial('base-inox-430', 'Inox 430', '430', 'stainless_steel', 7.7),
  // Aluminio
  baseMaterial('base-alu-1100', 'Aluminio 1100', '1100', 'aluminum', 2.71),
  baseMaterial('base-alu-5052', 'Aluminio 5052', '5052', 'aluminum', 2.68),
  baseMaterial('base-alu-6061', 'Aluminio 6061', '6061', 'aluminum', 2.70),
  // Ligas de cobre
  baseMaterial('base-cobre', 'Cobre', 'CU', 'copper_alloy', 8.96),
  baseMaterial('base-latao', 'Latao', 'LATAO', 'copper_alloy', 8.50),
  baseMaterial('base-bronze', 'Bronze', 'BRONZE', 'copper_alloy', 8.80),
];

export function cloneBaseMaterials(): MaterialConfig[] {
  return BASE_MATERIALS.map((m) => ({ ...m }));
}
