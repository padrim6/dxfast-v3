// DXFAST :: Toasts (avisos nao bloqueantes) no lugar de alert()
// Barramento simples em modulo, para poder ser chamado de qualquer lugar (ate de
// handlers fora de componentes). Monte <Toaster/> uma vez na raiz do app.
// Proibido o caractere traco-longo em qualquer string.

import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

let items: ToastItem[] = [];
let listeners: Array<(items: ToastItem[]) => void> = [];
let seq = 1;

function emit() {
  for (const l of listeners) l(items);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export function showToast(message: string, type: ToastType = 'info'): void {
  const it: ToastItem = { id: seq++, type, message };
  items = [...items, it].slice(-4); // no maximo 4 na tela
  emit();
  const ttl = type === 'error' ? 7000 : 3800;
  setTimeout(() => dismiss(it.id), ttl);
}

const STYLE: Record<ToastType, { bg: string; border: string; text: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', Icon: CheckCircle2 },
  error: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', Icon: AlertTriangle },
  info: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', Icon: Info },
};

export const Toaster: React.FC = () => {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    const l = (x: ToastItem[]) => setList([...x]);
    listeners.push(l);
    return () => { listeners = listeners.filter((z) => z !== l); };
  }, []);

  if (list.length === 0) return null;

  return (
    <div
      className="fixed z-[9999] bottom-4 right-4 flex flex-col gap-2 w-[min(92vw,22rem)]"
      aria-live="polite"
      aria-atomic="false"
    >
      {list.map((t) => {
        const s = STYLE[t.type];
        const Icon = s.Icon;
        return (
          <div
            key={t.id}
            className={`flex items-start gap-2 rounded-xl border ${s.border} ${s.bg} ${s.text} px-3.5 py-2.5 shadow-md text-sm`}
            role={t.type === 'error' ? 'alert' : 'status'}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 leading-snug whitespace-pre-line">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Fechar aviso">
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
