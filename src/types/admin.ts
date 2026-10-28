// DXFAST :: Tipos da fundacao administrativa (orcamento)
// Dados que o usuario cadastra uma vez e o motor de orcamento consome.
// Dinheiro em BRL, comprimento em mm, velocidade em mm/min, tempo em segundos
// (salvo onde o sufixo do campo indicar outra unidade). Proibido o caractere
// traco-longo em qualquer string, comentario ou rotulo.

export type MaterialGroup =
  | 'carbon_steel'
  | 'stainless_steel'
  | 'aluminum'
  | 'copper_alloy'
  | 'other';

export interface MaterialConfig {
  id: string;
  name: string;              // ex: "Aco Carbono 1020"
  code?: string;             // rotulo curto opcional (ex: "A36")
  group: MaterialGroup;
  densityGPerCm3: number;    // g/cm3
  pricePerKg: number | null; // BRL/kg; null = ainda nao preenchido
  isBase: boolean;           // true = veio da biblioteca base (edita, nao apaga)
}

export interface SheetStockConfig {
  id: string;
  materialId: string;                 // referencia MaterialConfig.id
  thicknessMm: number;
  widthMm: number;                    // dimensao padrao da chapa comprada
  lengthMm: number;
  pricePerSheet?: number | null;      // BRL pela chapa inteira
  pricePerKg?: number | null;         // BRL/kg (alternativa ao preco por chapa)
  densityGPerCm3Snapshot?: number;    // densidade congelada no momento do cadastro
  label?: string;                     // rotulo livre opcional
}

// Uma faixa de espessura de uma maquina de corte. Velocidade e tempo de
// perfuracao interpolam LINEARMENTE dentro da faixa.
export interface CuttingSpeedBand {
  thicknessMinMm: number;
  thicknessMaxMm: number;
  speedAtMinMmPerMin: number;  // velocidade na espessura minima (mais rapida)
  speedAtMaxMmPerMin: number;  // velocidade na espessura maxima (mais lenta)
  pierceAtMinSec: number;      // tempo de perfuracao na espessura minima
  pierceAtMaxSec: number;      // tempo de perfuracao na espessura maxima
}

export interface CuttingMachineConfig {
  id: string;
  name: string;
  type: 'laser' | 'plasma';
  hourlyRateBrl: number;         // BRL por hora de maquina
  setupTimeMinPerJob: number;    // minutos de preparacao por lote
  bands: CuttingSpeedBand[];     // faixas contiguas, crescentes por espessura
}

export interface BendingMachineConfig {
  id: string;
  name: string;
  hourlyRateBrl: number;         // BRL por hora
  setupTimeMinPerJob: number;    // minutos de preparacao por lote
  cycleTimeSecPerBend: number;   // tempo medio por dobra
  maxTonnageTons?: number;       // tonelagem maxima da prensa (informativo)
}

// Dados do cliente que recebe a proposta (impressos no PDF).
export interface ClientInfo {
  name?: string;
  contact?: string;   // telefone ou email
  company?: string;   // empresa do cliente, se diferente do nome
  cnpj?: string;
}

export interface CompanyAddress {
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface CompanyConfig {
  name: string;                      // razao social
  tradeName?: string;                // nome fantasia
  cnpj?: string;
  ie?: string;                       // inscricao estadual
  phone?: string;
  email?: string;
  logoUrl?: string;                  // data URL (upload simples, opcional)
  address: CompanyAddress;
  defaultQuoteValidityDays?: number; // validade padrao da proposta em dias
  standardTerms?: string;            // termos gerais que vao no rodape
  notes?: string;                    // observacao livre
}

export interface AppAdminConfig {
  schemaVersion: number;
  company: CompanyConfig;
  materials: MaterialConfig[];
  sheets: SheetStockConfig[];
  cuttingMachines: CuttingMachineConfig[];
  bendingMachines: BendingMachineConfig[];
}
