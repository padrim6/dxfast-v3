// DXFAST :: Historico de orcamentos (propostas geradas)
// Lista os registros salvos, permite reabrir (recarrega a peca ou o carrinho) e
// excluir. Proibido o caractere traco-longo em qualquer string.

import React, { useEffect, useState } from 'react';
import { History, ArrowLeft, RotateCcw, Trash2, FileText, ShoppingCart, Package } from 'lucide-react';
import { quoteHistoryStore, QuoteHistoryRecord } from '../../data/store/quoteHistoryStore';

interface HistoryViewProps {
  onReopen: (rec: QuoteHistoryRecord) => void;
  onBack: () => void;
}

const money = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

export const HistoryView: React.FC<HistoryViewProps> = ({ onReopen, onBack }) => {
  const [records, setRecords] = useState<QuoteHistoryRecord[]>([]);
  useEffect(() => { setRecords(quoteHistoryStore.list()); }, []);

  const remove = (id: string) => { quoteHistoryStore.remove(id); setRecords(quoteHistoryStore.list()); };
  const clearAll = () => { if (confirm('Apagar todo o historico de orcamentos?')) { quoteHistoryStore.clear(); setRecords([]); } };

  return (
    <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-5 lg:p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <History className="w-5 h-5 text-[#FF3000]" /> Historico de Orcamentos
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-200 text-slate-700">{records.length}</span>
        </h1>
        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <button onClick={clearAll} className="tap-target flex items-center gap-1.5 px-3 h-9 text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-lg text-xs font-semibold border border-slate-200">
              <Trash2 className="w-4 h-4" /> Limpar tudo
            </button>
          )}
          <button onClick={onBack} className="tap-target flex items-center gap-1.5 px-3 h-9 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg text-xs font-semibold border border-slate-200">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          <History className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-700">Nenhum orcamento no historico ainda.</p>
          <p className="text-xs mt-1">Cada proposta que voce gerar (peca unica ou lote) aparece aqui para reabrir depois.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Data</th>
                <th className="text-left px-4 py-2.5">Cliente</th>
                <th className="text-left px-4 py-2.5">Tipo</th>
                <th className="text-right px-4 py-2.5">Itens</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">{fmtDate(r.dateISO)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.clientName?.trim() || <span className="text-slate-400">sem cliente</span>}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      {r.kind === 'cart' ? <ShoppingCart className="w-3.5 h-3.5 text-blue-600" /> : <FileText className="w-3.5 h-3.5 text-[#FF3000]" />}
                      {r.kind === 'cart' ? 'Lote' : 'Peca unica'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-600">{r.itemCount}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">{money(r.total)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onReopen(r)} className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 mr-3 text-xs font-semibold" title="Reabrir este orcamento">
                      <RotateCcw className="w-3.5 h-3.5" /> Reabrir
                    </button>
                    <button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-700" title="Excluir do historico" aria-label="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" /> O historico fica salvo neste navegador (ultimos {20} orcamentos). Reabrir uma peca unica recarrega o configurador; reabrir um lote recarrega o carrinho.
      </p>
    </main>
  );
};
