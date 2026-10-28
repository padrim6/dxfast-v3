// DXFAST :: Numeros no padrao pt-BR (aceita virgula como separador decimal)
// Proibido o caractere traco-longo em qualquer string.

// Converte texto digitado (com virgula ou ponto) em numero, ou null se invalido.
// Aceita "3,5", "3.5", "1.200,50" (ponto de milhar) e "1200.50".
export function parseDecimalPtBr(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === '') return null;
  // remove espacos e simbolos comuns
  s = s.replace(/\s/g, '').replace(/r\$/i, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // assume ponto como milhar e virgula como decimal (padrao pt-BR)
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Formata um numero para exibicao em pt-BR com virgula (sem forcar casas).
export function formatDecimalPtBr(n: number, maxFractionDigits = 4): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: maxFractionDigits });
}
