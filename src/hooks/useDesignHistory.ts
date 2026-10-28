import { useEffect, useRef, useState, useCallback } from 'react';
import { useDebounce } from './useDebounce';
import { DesignSnapshot } from '../utils/projectIO';

const MAX_HISTORY = 60;

/**
 * Histórico de desfazer/refazer para o estado da peça (modelo + parâmetros +
 * features + nome). Grava um ponto do histórico quando o usuário para de mexer
 * (debounce), evitando uma entrada por tecla/arraste. A gravação é protegida
 * contra o "eco" de um restore por comparação do conteúdo (não por flag de
 * tempo), o que a torna robusta ao atraso do debounce.
 */
export function useDesignHistory(
  snapshot: DesignSnapshot,
  apply: (s: DesignSnapshot) => void,
  debounceMs = 400
) {
  const debounced = useDebounce(snapshot, debounceMs);
  const listRef = useRef<string[]>([JSON.stringify(snapshot)]);
  const indexRef = useRef(0);
  const lastRef = useRef<string>(JSON.stringify(snapshot));
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  // Grava um novo ponto quando o estado estabilizado difere do último conhecido.
  useEffect(() => {
    const cur = JSON.stringify(debounced);
    if (cur === lastRef.current) return; // eco de um restore ou nada mudou
    const list = listRef.current.slice(0, indexRef.current + 1);
    list.push(cur);
    if (list.length > MAX_HISTORY) list.shift();
    listRef.current = list;
    indexRef.current = list.length - 1;
    lastRef.current = cur;
    bump();
  }, [debounced]);

  const restore = useCallback(
    (idx: number) => {
      const snap = listRef.current[idx];
      if (!snap) return;
      indexRef.current = idx;
      lastRef.current = snap;
      try {
        apply(JSON.parse(snap));
      } catch {
        /* snapshot corrompido: ignora */
      }
      bump();
    },
    [apply]
  );

  const undo = useCallback(() => {
    if (indexRef.current > 0) restore(indexRef.current - 1);
  }, [restore]);

  const redo = useCallback(() => {
    if (indexRef.current < listRef.current.length - 1) restore(indexRef.current + 1);
  }, [restore]);

  // Reinicia o histórico (ex.: ao abrir um projeto ou trocar de modelo pela biblioteca).
  const reset = useCallback((base: DesignSnapshot) => {
    const s = JSON.stringify(base);
    listRef.current = [s];
    indexRef.current = 0;
    lastRef.current = s;
    bump();
  }, []);

  return {
    undo,
    redo,
    reset,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < listRef.current.length - 1,
  };
}
