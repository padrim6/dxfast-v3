// DXFAST :: Campo numerico pt-BR (aceita virgula, setas sobem/descem o valor)
// Exibe o numero com virgula, aceita virgula ou ponto na digitacao, e comita o
// valor numerico. Proibido o caractere traco-longo em qualquer string.

import React, { useEffect, useRef, useState } from 'react';
import { parseDecimalPtBr, formatDecimalPtBr } from '../../utils/ptNumber';

interface DecimalInputProps {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  maxFractionDigits?: number;
}

export const DecimalInput: React.FC<DecimalInputProps> = ({
  value, onCommit, step = 1, min, max, className, placeholder, maxFractionDigits = 4, ...rest
}) => {
  const [txt, setTxt] = useState<string>(formatDecimalPtBr(value, maxFractionDigits));
  const focused = useRef(false);

  // Sincroniza o texto quando o valor externo muda e o campo nao esta em foco.
  useEffect(() => {
    if (!focused.current) setTxt(formatDecimalPtBr(value, maxFractionDigits));
  }, [value, maxFractionDigits]);

  const clampStep = (n: number): number => {
    let r = n;
    if (typeof min === 'number') r = Math.max(min, r);
    if (typeof max === 'number') r = Math.min(max, r);
    return Number(r.toFixed(maxFractionDigits));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={txt}
      placeholder={placeholder}
      aria-label={rest['aria-label']}
      className={className}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v);
        const n = parseDecimalPtBr(v);
        if (n !== null) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const base = parseDecimalPtBr(txt) ?? value ?? 0;
          const next = clampStep(base + (e.key === 'ArrowUp' ? step : -step));
          setTxt(formatDecimalPtBr(next, maxFractionDigits));
          onCommit(next);
        }
      }}
      onBlur={() => {
        focused.current = false;
        // Reflete o valor efetivo apos qualquer limite aplicado pelo pai (clamp).
        setTxt(formatDecimalPtBr(value, maxFractionDigits));
      }}
    />
  );
};

// Variante que aceita vazio (valor nulo), para precos ainda nao definidos.
interface NullableDecimalInputProps {
  value: number | null | undefined;
  onCommit: (n: number | null) => void;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
  maxFractionDigits?: number;
}

export const NullableDecimalInput: React.FC<NullableDecimalInputProps> = ({
  value, onCommit, className, placeholder, maxFractionDigits = 2, ...rest
}) => {
  const [txt, setTxt] = useState<string>(value == null ? '' : formatDecimalPtBr(value, maxFractionDigits));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setTxt(value == null ? '' : formatDecimalPtBr(value, maxFractionDigits));
  }, [value, maxFractionDigits]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={txt}
      placeholder={placeholder}
      aria-label={rest['aria-label']}
      className={className}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v);
        if (v.trim() === '') { onCommit(null); return; }
        const n = parseDecimalPtBr(v);
        if (n !== null) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        if (txt.trim() === '') { onCommit(null); setTxt(''); return; }
        // Reflete o valor efetivo (ja comitado) apos o blur.
        setTxt(value == null ? '' : formatDecimalPtBr(value, maxFractionDigits));
      }}
    />
  );
};
