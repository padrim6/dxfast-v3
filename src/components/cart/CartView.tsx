// DXFAST :: Tela do Carrinho de Corte (lote de pecas variadas)
// Lista os itens (com quantidade), seleciona maquina/chapa, aninha o lote inteiro
// com o nester heterogeneo e mostra o orcamento consolidado + o leiaute de cada
// chapa. Proibido o caractere traco-longo em qualquer string.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ShoppingCart, Trash2, Flame, FoldHorizontal, Layers, AlertTriangle, ArrowLeft, Plus, Minus, FileDown, Copy, Pencil } from 'lucide-react';
import { AppAdminConfig, ClientInfo } from '../../types/admin';
import { configStore } from '../../data/store/configStore';
import { sessionStore } from '../../data/store/sessionStore';
import { showToast } from '../ui/toast';
import { DecimalInput } from '../ui/DecimalInput';
import { CartItem, computeCartQuote } from '../../quote/cartQuote';
import { quoteHistoryStore } from '../../data/store/quoteHistoryStore';
import { tessellatePart } from '../quote/partOutline';
import { SheetNestPreview, PartLoopsLite } from './SheetNestPreview';

// Campo de quantidade que permite apagar o digito enquanto digita (so volta a 1
// se ficar vazio ao sair do campo), em vez de travar sempre em 1.
const QtyInput: React.FC<{ value: number; onCommit: (n: number) => void }> = ({ value, onCommit }) => {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt(String(value)); }, [value]);
  return (
    <input
      type="number"
      min={1}
      inputMode="numeric"
      value={txt}
      onChange={(e) => {
        const v = e.target.value;
        setTxt(v); // permite vazio enquanto digita
        if (v !== '' && /^\d+$/.test(v)) {
          const n = parseInt(v, 10);
          if (n >= 1) onCommit(n);
        }
      }}
      onBlur={() => {
        const n = parseInt(txt, 10);
        if (!(n >= 1)) { setTxt('1'); onCommit(1); } else { setTxt(String(n)); }
      }}
      className="tap-target w-12 text-center px-1 h-8 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900"
      aria-label="Quantidade"
    />
  );
};

interface CartViewProps {
  items: CartItem[];
  onUpdateQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEdit: (id: string) => void;
  onBack: () => void;
  onNavigateToAdmin?: () => void;
}

const PALETTE = [
  { fill: '#bfdbfe', line: '#2563eb' }, { fill: '#bbf7d0', line: '#16a34a' },
  { fill: '#fde68a', line: '#d97706' }, { fill: '#fbcfe8', line: '#db2777' },
  { fill: '#ddd6fe', line: '#7c3aed' }, { fill: '#fed7aa', line: '#ea580c' },
  { fill: '#a5f3fc', line: '#0891b2' }, { fill: '#fecaca', line: '#dc2626' },
];
const money = (n: number) => `R$ ${n.toFixed(2)}`;

export const CartView: React.FC<CartViewProps> = ({ items, onUpdateQty, onRemove, onDuplicate, onEdit, onBack, onNavigateToAdmin }) => {
  const [config, setConfig] = useState<AppAdminConfig | null>(null);
  const [selectedCuttingId, setSelectedCuttingId] = useState('');
  const [selectedBendingId, setSelectedBendingId] = useState('');
  const [marginPercent, setMarginPercent] = useState(20);
  const [gapMm, setGapMm] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  // Chapa escolhida manualmente por espessura (item 7)
  const [sheetOverrides, setSheetOverrides] = useState<Record<number, string>>({});
  const [client, setClient] = useState<ClientInfo>(() => sessionStore.loadClient() || {});
  useEffect(() => { sessionStore.saveClient(client); }, [client]);

  useEffect(() => {
    let mounted = true;
    configStore.getConfig().then((c) => {
      if (!mounted) return;
      setConfig(c);
      if (c.cuttingMachines.length) setSelectedCuttingId(c.cuttingMachines[0].id);
      if (c.bendingMachines.length) setSelectedBendingId(c.bendingMachines[0].id);
    });
    return () => { mounted = false; };
  }, []);

  const colorByKey = useMemo(() => {
    const map: Record<string, { fill: string; line: string }> = {};
    items.forEach((it, i) => { map[it.id] = PALETTE[i % PALETTE.length]; });
    return map;
  }, [items]);

  const partsLoops = useMemo(() => {
    const map: Record<string, PartLoopsLite> = {};
    for (const it of items) {
      const t = tessellatePart(it.geometry);
      map[it.id] = { outer: t.outer, holes: t.holes, w: t.w, h: t.h };
    }
    return map;
  }, [items]);

  // Orcamento base (margem 0): contem o aninhamento pesado. Nao depende da margem,
  // entao arrastar a margem nao dispara um novo nesting do lote inteiro.
  const baseQuote = useMemo(() => {
    if (!config) return null;
    return computeCartQuote({
      items,
      cuttingMachine: config.cuttingMachines.find((m) => m.id === selectedCuttingId) || null,
      bendingMachine: config.bendingMachines.find((m) => m.id === selectedBendingId) || null,
      sheets: config.sheets,
      materials: config.materials,
      marginPercent: 0,
      gapMm,
      sheetOverrides,
    });
  }, [config, items, selectedCuttingId, selectedBendingId, gapMm, sheetOverrides]);

  // Aplica a margem (multiplicador puro) de forma barata sobre o orcamento base.
  const quote = useMemo(() => {
    if (!baseQuote) return null;
    const m = Math.max(0, marginPercent);
    return { ...baseQuote, marginPercent: m, total: baseQuote.subtotal * (1 + m / 100) };
  }, [baseQuote, marginPercent]);

  const handleGenerateProposal = useCallback(async () => {
    if (!config || !quote || quote.blocked || items.length === 0) return;
    try {
      setIsGenerating(true);
      const company = await configStore.getCompany();
      const { generateCartProposalPdf } = await import('../../quote/cartProposalPdf');
      generateCartProposalPdf({ company, items, quote, materials: config.materials, client });
      try {
        quoteHistoryStore.add({ kind: 'cart', clientName: client.name, total: quote.total, itemCount: quote.totalParts, cart: { items } });
      } catch { /* historico e best-effort */ }
      showToast('Proposta do lote (PDF) gerada.', 'success');
    } catch (err) {
      console.error('Erro ao gerar a proposta do lote:', err);
      showToast('Nao foi possivel gerar a proposta do lote.', 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [config, quote, items, client]);

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 flex flex-col gap-5">
      {/* Cabecalho */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900 font-heading flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-[#FF3000]" /> Carrinho de Corte
          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-200 text-slate-700">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>
        </h1>
        {items.length === 0 && (
          <button onClick={onBack} className="tap-target flex items-center gap-1.5 px-3 h-9 text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg text-xs font-semibold transition border border-slate-200">
            <ArrowLeft className="w-4 h-4" /> <span>Escolher peças</span>
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          <ShoppingCart className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-700">Seu carrinho esta vazio.</p>
          <p className="text-xs mt-1">Configure uma peca (ou importe um DXF) e use "Adicionar ao carrinho".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Coluna esquerda: itens + controles */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Itens do lote</h3>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={it.id} className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                    <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: colorByKey[it.id].fill, border: `1.5px solid ${colorByKey[it.id].line}` }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900 truncate">{it.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {it.geometry.metrics.blankWidthMm.toFixed(0)}x{it.geometry.metrics.blankHeightMm.toFixed(0)} mm - {it.thicknessMm} mm
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onUpdateQty(it.id, Math.max(1, it.qty - 1))} className="tap-target w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" aria-label="Diminuir quantidade"><Minus className="w-3.5 h-3.5" /></button>
                      <QtyInput value={it.qty} onCommit={(n) => onUpdateQty(it.id, n)} />
                      <button onClick={() => onUpdateQty(it.id, it.qty + 1)} className="tap-target w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" aria-label="Aumentar quantidade"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                    <button onClick={() => onEdit(it.id)} className="tap-target w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-[#FF3000] hover:bg-red-50 shrink-0" aria-label="Editar item" title="Editar no configurador"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => onDuplicate(it.id)} className="tap-target w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 shrink-0" aria-label="Duplicar item" title="Duplicar"><Copy className="w-4 h-4" /></button>
                    <button onClick={() => onRemove(it.id)} className="tap-target w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0" aria-label="Remover item"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            {/* Controles */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2">
                <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5"><Flame className="w-3.5 h-3.5 text-[#FF3000]" /> Maquina de Corte</label>
                <select value={selectedCuttingId} onChange={(e) => setSelectedCuttingId(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]">
                  {config?.cuttingMachines.map((m) => <option key={m.id} value={m.id}>{m.name} (R$ {m.hourlyRateBrl}/h)</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5"><FoldHorizontal className="w-3.5 h-3.5 text-amber-600" /> Dobradeira (opcional)</label>
                <select value={selectedBendingId} onChange={(e) => setSelectedBendingId(e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]">
                  <option value="">Nenhuma</option>
                  {config?.bendingMachines.map((m) => <option key={m.id} value={m.id}>{m.name}{m.maxTonnageTons ? ` (${m.maxTonnageTons}T)` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Margem (%)</label>
                <DecimalInput value={marginPercent} onCommit={(n) => setMarginPercent(Math.max(0, n))} step={1} min={0} max={500} maxFractionDigits={2} aria-label="Margem em porcentagem" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#FF3000]" />
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Espaçamento / Margem (mm)</label>
                <DecimalInput value={gapMm} onCommit={(n) => setGapMm(Math.min(20, Math.max(1, n)))} step={1} min={1} max={20} maxFractionDigits={1} aria-label="Espacamento em milimetros" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-[#FF3000]" />
              </div>
            </div>
          </div>

          {/* Coluna direita: orcamento + leiautes */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            {quote && quote.blocked ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-xs text-red-800">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div><h4 className="font-bold text-red-900">Orçamento indisponível</h4><p className="mt-0.5">{quote.reason}</p></div>
              </div>
            ) : quote ? (
              <>
                {/* Destaque de total */}
                <div className="grid grid-cols-2 gap-4 p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl shadow-md">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Valor Total do Lote</span>
                    <div className="text-3xl font-black font-mono text-emerald-400 mt-1">{money(quote.total)}</div>
                    <div className="text-[11px] text-slate-300 mt-1 font-mono">{quote.totalParts} peças - {quote.totalSheets} chapa(s) - +{quote.marginPercent}% margem</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono self-center">
                    <div><span className="text-slate-400 block">Material</span><span className="text-slate-100 font-bold">{money(quote.materialCost)}</span></div>
                    <div><span className="text-slate-400 block">Corte</span><span className="text-slate-100 font-bold">{money(quote.cuttingCost)}</span></div>
                    <div><span className="text-slate-400 block">Dobra</span><span className="text-slate-100 font-bold">{money(quote.bendingCost)}</span></div>
                    <div><span className="text-slate-400 block">Setup</span><span className="text-slate-100 font-bold">{money(quote.setupCost)}</span></div>
                    <div><span className="text-slate-400 block">Peso (frete)</span><span className="text-slate-100 font-bold">{quote.orderWeightKg.toFixed(1)} kg</span></div>
                    <div><span className="text-slate-400 block">Sucata</span><span className="text-slate-100 font-bold">{quote.scrapKg.toFixed(1)} kg</span></div>
                  </div>
                </div>

                {/* Dados do cliente (impressos na proposta, lembrados entre sessoes) */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-xs grid grid-cols-2 gap-2">
                  <input
                    value={client.name || ''}
                    onChange={(e) => setClient((c) => ({ ...c, name: e.target.value }))}
                    placeholder="Cliente (nome)"
                    className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]"
                    aria-label="Nome do cliente"
                  />
                  <input
                    value={client.contact || ''}
                    onChange={(e) => setClient((c) => ({ ...c, contact: e.target.value }))}
                    placeholder="Contato (telefone ou email)"
                    className="px-2.5 py-2 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]"
                    aria-label="Contato do cliente"
                  />
                </div>

                {/* Gerar proposta comercial do lote */}
                <button
                  onClick={handleGenerateProposal}
                  disabled={isGenerating || quote.totalSheets === 0}
                  className={`tap-target w-full flex items-center justify-center gap-2 px-4 h-11 rounded-xl text-sm font-bold shadow-sm transition active:scale-[0.99] ${
                    isGenerating || quote.totalSheets === 0
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-[#FF3000] hover:bg-[#e62b00] text-white'
                  }`}
                  title="Gerar a proposta comercial do lote em PDF (A4)"
                >
                  <FileDown className="w-4 h-4" />
                  <span>{isGenerating ? 'Gerando proposta...' : 'Gerar Proposta do Lote (PDF)'}</span>
                </button>

                {/* Grupos por espessura com leiaute das chapas */}
                {quote.groups.map((g, gi) => (
                  <div key={gi} className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Layers className="w-4 h-4 text-blue-600" /> Espessura {g.thicknessMm} mm</span>
                      <span className="text-xs font-mono text-slate-600">{g.totalParts} peças - <strong className="text-slate-900">{g.sheetsNeeded} chapa(s)</strong> {g.sheet ? `(${g.sheet.widthMm}x${g.sheet.lengthMm})` : ''}</span>
                    </div>
                    {g.sheet && g.sheetsNeeded > 0 && (
                      <div className="text-[11px] font-mono text-slate-500">
                        Aproveitamento {g.utilizationPercent.toFixed(0)}% - sucata {g.scrapKg.toFixed(1)} kg ({g.scrapPercent.toFixed(0)}%) - peso das peças {g.orderWeightKg.toFixed(1)} kg
                      </div>
                    )}
                    {(() => {
                      if (!config) return null;
                      const matching = config.sheets.filter((s) => Math.round(s.thicknessMm * 10) / 10 === g.thicknessMm);
                      if (matching.length <= 1) return null;
                      return (
                        <label className="flex items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-semibold">Chapa:</span>
                          <select
                            value={g.sheet?.id || ''}
                            onChange={(e) => setSheetOverrides((o) => ({ ...o, [g.thicknessMm]: e.target.value }))}
                            className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-800 focus:outline-none focus:border-[#FF3000]"
                          >
                            {matching.map((s) => (
                              <option key={s.id} value={s.id}>{s.widthMm}x{s.lengthMm} mm{s.label ? ` - ${s.label}` : ''}</option>
                            ))}
                          </select>
                        </label>
                      );
                    })()}
                    {g.blockedReason && (
                      <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" /><span>{g.blockedReason}</span>
                      </div>
                    )}
                    <div className="space-y-3">
                      {g.sheet && g.nestSheets.map((s, si) => (
                        <div key={si}>
                          <div className="text-[11px] font-mono text-slate-500 mb-1">Chapa {si + 1} de {g.sheetsNeeded}</div>
                          <SheetNestPreview sheetWmm={g.sheet!.widthMm} sheetLmm={g.sheet!.lengthMm} gapMm={gapMm} placements={s.placements} partsLoops={partsLoops} colorByKey={colorByKey} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Aninhamento real por silhueta (encaixe entre pecas), conservador: o numero de chapas nunca e subestimado. O corte profissional pode render um pouco mais.
                </p>
              </>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">Carregando parâmetros fabris...</div>
            )}
          </div>
        </div>
      )}
    </main>
  );
};
