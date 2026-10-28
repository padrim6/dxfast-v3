// DXFAST :: Painel Administrativo (fundacao de dados do orcamento)
// Cinco secoes: empresa, materiais, chapas, maquinas de corte, maquinas de dobra.
// Todo acesso a dados passa pelo configStore (unico ponto de localStorage).
// Portugues do Brasil na interface. Proibido o caractere traco-longo.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Layers, Sheet as SheetIcon, Flame, FoldHorizontal,
  Plus, Trash2, Save, RotateCcw, Download, Upload, AlertTriangle, Info,
} from 'lucide-react';
import {
  AppAdminConfig, CompanyConfig, MaterialConfig, SheetStockConfig,
  CuttingMachineConfig, BendingMachineConfig, CuttingSpeedBand, MaterialGroup,
} from '../../types/admin';
import { configStore, genId } from '../../data/store/configStore';
import { defaultBandsFor } from '../../data/store/cuttingMath';
import { showToast } from '../ui/toast';
import { downloadBlob } from '../../utils/download';
import { DecimalInput, NullableDecimalInput } from '../ui/DecimalInput';

interface AdminPanelProps {
  onBackToLibrary: () => void;
}

type TabId = 'company' | 'materials' | 'sheets' | 'cutting' | 'bending';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'company', label: 'Dados da Empresa', icon: Building2 },
  { id: 'materials', label: 'Materiais', icon: Layers },
  { id: 'sheets', label: 'Chapas', icon: SheetIcon },
  { id: 'cutting', label: 'Maquinas de Corte', icon: Flame },
  { id: 'bending', label: 'Maquinas de Dobra', icon: FoldHorizontal },
];

const GROUP_LABELS: Record<MaterialGroup, string> = {
  carbon_steel: 'Aco Carbono',
  stainless_steel: 'Inox',
  aluminum: 'Aluminio',
  copper_alloy: 'Liga de Cobre',
  other: 'Outro',
};

const card = 'bg-white rounded-2xl shadow-sm border border-slate-200';
const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500';
const btnPrimary = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF3000] text-white text-sm font-semibold hover:bg-red-600 transition-colors';
const btnGhost = 'inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 transition-colors';

const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const AdminPanel: React.FC<AdminPanelProps> = ({ onBackToLibrary }) => {
  const [tab, setTab] = useState<TabId>('company');
  const [config, setConfig] = useState<AppAdminConfig | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => setConfig(await configStore.getConfig());
  useEffect(() => { reload(); }, []);

  const persistenceFailed = configStore.hasPersistenceFailed();

  const handleExport = async () => {
    const json = await configStore.exportConfig();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    // Mesma camada resiliente dos demais downloads (API do artefato / pagina de
    // topo / nova aba), com o JSON disponivel para a area de transferencia.
    await downloadBlob(blob, 'dxfast-configuracao.json', json);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = await configStore.importConfig(text);
    if (!res.ok) {
      showToast(`Nao foi possivel importar: ${res.error}`, 'error');
    } else {
      await reload();
      showToast('Configuracao importada com sucesso.', 'success');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!config) {
    return <div className="p-8 text-slate-500">Carregando configuracoes...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <button className={btnGhost} onClick={onBackToLibrary}>
            <ArrowLeft size={16} /> Voltar
          </button>
          <h1 className="text-xl font-bold text-slate-900">Painel Administrativo</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className={btnGhost} onClick={handleExport}><Download size={16} /> Exportar</button>
          <button className={btnGhost} onClick={() => fileRef.current?.click()}><Upload size={16} /> Importar</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {persistenceFailed && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>Nao foi possivel salvar neste navegador. Seus dados podem nao persistir. Use o botao Exportar para guardar um backup.</span>
        </div>
      )}

      <div className="mb-4 flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-500">
        <Info size={16} className="mt-0.5 shrink-0" />
        <span>Os dados ficam salvos neste navegador (ainda nao ha conta na nuvem). Recomendamos exportar um backup periodicamente.</span>
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${active ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'company' && <CompanySection company={config.company} onSaved={reload} />}
      {tab === 'materials' && <MaterialsSection materials={config.materials} onChanged={reload} />}
      {tab === 'sheets' && <SheetsSection sheets={config.sheets} materials={config.materials} onChanged={reload} />}
      {tab === 'cutting' && <CuttingSection machines={config.cuttingMachines} onChanged={reload} />}
      {tab === 'bending' && <BendingSection machines={config.bendingMachines} onChanged={reload} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secao: Empresa
// ---------------------------------------------------------------------------
const CompanySection: React.FC<{ company: CompanyConfig; onSaved: () => void }> = ({ company, onSaved }) => {
  const [form, setForm] = useState<CompanyConfig>(company);
  useEffect(() => { setForm(company); }, [company]);
  const set = (patch: Partial<CompanyConfig>) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (patch: Partial<CompanyConfig['address']>) => setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));

  const save = async () => { await configStore.saveCompany(form); onSaved(); showToast('Dados da empresa salvos.', 'success'); };

  return (
    <div className={`${card} p-6`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Razao Social"><input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Nome Fantasia"><input className={inputCls} value={form.tradeName || ''} onChange={(e) => set({ tradeName: e.target.value })} /></Field>
        <Field label="CNPJ"><input className={inputCls} value={form.cnpj || ''} onChange={(e) => set({ cnpj: e.target.value })} /></Field>
        <Field label="Inscricao Estadual"><input className={inputCls} value={form.ie || ''} onChange={(e) => set({ ie: e.target.value })} /></Field>
        <Field label="Telefone"><input className={inputCls} value={form.phone || ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field label="Email"><input className={inputCls} value={form.email || ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Rua"><input className={inputCls} value={form.address.street || ''} onChange={(e) => setAddr({ street: e.target.value })} /></Field>
        <Field label="Numero"><input className={inputCls} value={form.address.number || ''} onChange={(e) => setAddr({ number: e.target.value })} /></Field>
        <Field label="Bairro"><input className={inputCls} value={form.address.neighborhood || ''} onChange={(e) => setAddr({ neighborhood: e.target.value })} /></Field>
        <Field label="Cidade"><input className={inputCls} value={form.address.city || ''} onChange={(e) => setAddr({ city: e.target.value })} /></Field>
        <Field label="UF"><input className={inputCls} value={form.address.state || ''} onChange={(e) => setAddr({ state: e.target.value })} /></Field>
        <Field label="CEP"><input className={inputCls} value={form.address.zipCode || ''} onChange={(e) => setAddr({ zipCode: e.target.value })} /></Field>
        <Field label="Validade padrao da proposta (dias)"><input type="number" className={inputCls} value={form.defaultQuoteValidityDays ?? 10} onChange={(e) => set({ defaultQuoteValidityDays: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4">
        <Field label="Termos gerais de fornecimento (rodape da proposta)">
          <textarea className={`${inputCls} h-28`} value={form.standardTerms || ''} onChange={(e) => set({ standardTerms: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5"><button className={btnPrimary} onClick={save}><Save size={16} /> Salvar dados da empresa</button></div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secao: Materiais
// ---------------------------------------------------------------------------
const emptyMaterial = (): MaterialConfig => ({ id: genId(), name: '', code: '', group: 'carbon_steel', densityGPerCm3: 7.85, pricePerKg: null, isBase: false });

const MaterialsSection: React.FC<{ materials: MaterialConfig[]; onChanged: () => void }> = ({ materials, onChanged }) => {
  const [editing, setEditing] = useState<MaterialConfig | null>(null);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { showToast('Informe o nome do material.', 'error'); return; }
    if (!(editing.densityGPerCm3 > 0)) { showToast('A densidade deve ser maior que zero.', 'error'); return; }
    await configStore.saveMaterial(editing);
    setEditing(null); onChanged();
    showToast('Material salvo.', 'success');
  };
  const remove = async (m: MaterialConfig) => {
    if (m.isBase) { showToast('Materiais da biblioteca base nao sao apagados individualmente. Use "Restaurar biblioteca base".', 'info'); return; }
    if (confirm(`Apagar o material "${m.name}"?`)) { await configStore.deleteMaterial(m.id); onChanged(); }
  };
  const resetBase = async () => {
    if (confirm('Restaurar a biblioteca base de materiais? Os materiais base voltam aos valores de fabrica. Seus materiais personalizados sao preservados.')) {
      await configStore.resetMaterialsToBase(); onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className={btnPrimary} onClick={() => setEditing(emptyMaterial())}><Plus size={16} /> Novo material</button>
        <button className={btnGhost} onClick={resetBase}><RotateCcw size={16} /> Restaurar biblioteca base</button>
      </div>

      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2">Material</th><th className="text-left px-4 py-2">Grupo</th><th className="text-right px-4 py-2">Densidade</th><th className="text-right px-4 py-2">Preco/kg</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{m.name} {m.isBase && <span className="ml-1 text-[10px] text-slate-400">(base)</span>}</td>
                <td className="px-4 py-2 text-slate-500">{GROUP_LABELS[m.group]}</td>
                <td className="px-4 py-2 text-right">{m.densityGPerCm3.toFixed(2)} g/cm3</td>
                <td className="px-4 py-2 text-right">{m.pricePerKg == null ? <span className="text-slate-400">nao definido</span> : `R$ ${m.pricePerKg.toFixed(2)}`}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="text-slate-500 hover:text-slate-900 mr-3" onClick={() => setEditing({ ...m })}>Editar</button>
                  {!m.isBase && <button className="text-red-500 hover:text-red-700" onClick={() => remove(m)}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-slate-800 mb-3">{editing.isBase ? 'Editar material base' : 'Material personalizado'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome"><input className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Codigo"><input className={inputCls} value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
            <Field label="Grupo">
              <select className={inputCls} value={editing.group} onChange={(e) => setEditing({ ...editing, group: e.target.value as MaterialGroup })}>
                {(Object.keys(GROUP_LABELS) as MaterialGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
              </select>
            </Field>
            <Field label="Densidade (g/cm3)"><DecimalInput value={editing.densityGPerCm3} onCommit={(n) => setEditing({ ...editing, densityGPerCm3: n })} step={0.01} min={0} maxFractionDigits={3} className={inputCls} aria-label="Densidade" /></Field>
            <Field label="Preco por kg (BRL)" hint="Aceita virgula. Deixe em branco se ainda nao definido">
              <NullableDecimalInput value={editing.pricePerKg} onCommit={(n) => setEditing({ ...editing, pricePerKg: n })} className={inputCls} aria-label="Preco por kg" />
            </Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} onClick={save}><Save size={16} /> Salvar</button>
            <button className={btnGhost} onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secao: Chapas
// ---------------------------------------------------------------------------
const emptySheet = (materialId: string): SheetStockConfig => ({ id: genId(), materialId, thicknessMm: 3.0, widthMm: 1200, lengthMm: 3000, pricePerSheet: null, pricePerKg: null });

const SheetsSection: React.FC<{ sheets: SheetStockConfig[]; materials: MaterialConfig[]; onChanged: () => void }> = ({ sheets, materials, onChanged }) => {
  const [editing, setEditing] = useState<SheetStockConfig | null>(null);
  const matName = (id: string) => materials.find((m) => m.id === id)?.name || 'Material removido';

  const save = async () => {
    if (!editing) return;
    if (!editing.materialId) { showToast('Selecione o material.', 'error'); return; }
    if (!(editing.thicknessMm > 0 && editing.widthMm > 0 && editing.lengthMm > 0)) { showToast('Espessura e dimensoes devem ser maiores que zero.', 'error'); return; }
    const mat = materials.find((m) => m.id === editing.materialId);
    await configStore.saveSheet({ ...editing, densityGPerCm3Snapshot: mat?.densityGPerCm3 });
    setEditing(null); onChanged();
    showToast('Chapa salva.', 'success');
  };
  const remove = async (s: SheetStockConfig) => { if (confirm('Apagar esta chapa?')) { await configStore.deleteSheet(s.id); onChanged(); } };

  return (
    <div className="space-y-4">
      <button className={btnPrimary} onClick={() => setEditing(emptySheet(materials[0]?.id || ''))}><Plus size={16} /> Nova chapa</button>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2">Material</th><th className="text-right px-4 py-2">Espessura</th><th className="text-right px-4 py-2">Dimensoes</th><th className="text-right px-4 py-2">Preco</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {sheets.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Nenhuma chapa cadastrada.</td></tr>}
            {sheets.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{matName(s.materialId)}</td>
                <td className="px-4 py-2 text-right">{s.thicknessMm} mm</td>
                <td className="px-4 py-2 text-right">{s.widthMm} x {s.lengthMm} mm</td>
                <td className="px-4 py-2 text-right">{s.pricePerSheet != null && s.pricePerSheet > 0 ? `R$ ${s.pricePerSheet.toFixed(2)}/chapa` : s.pricePerKg != null && s.pricePerKg > 0 ? `R$ ${s.pricePerKg.toFixed(2)}/kg` : <span className="text-slate-400">nao definido</span>}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="text-slate-500 hover:text-slate-900 mr-3" onClick={() => setEditing({ ...s })}>Editar</button>
                  <button className="text-red-500 hover:text-red-700" onClick={() => remove(s)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={`${card} p-5`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Material">
              <select className={inputCls} value={editing.materialId} onChange={(e) => setEditing({ ...editing, materialId: e.target.value })}>
                <option value="">Selecione</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Espessura (mm)"><DecimalInput value={editing.thicknessMm} onCommit={(n) => setEditing({ ...editing, thicknessMm: n })} step={0.1} min={0} maxFractionDigits={2} className={inputCls} aria-label="Espessura" /></Field>
            <Field label="Largura da chapa (mm)"><input type="number" className={inputCls} value={editing.widthMm} onChange={(e) => setEditing({ ...editing, widthMm: Number(e.target.value) })} /></Field>
            <Field label="Comprimento da chapa (mm)"><input type="number" className={inputCls} value={editing.lengthMm} onChange={(e) => setEditing({ ...editing, lengthMm: Number(e.target.value) })} /></Field>
            <Field label="Preco por chapa (BRL)" hint="Aceita virgula. Preencha este OU o preco por kg"><NullableDecimalInput value={editing.pricePerSheet} onCommit={(n) => setEditing({ ...editing, pricePerSheet: n })} className={inputCls} aria-label="Preco por chapa" /></Field>
            <Field label="Preco por kg (BRL)" hint="Aceita virgula. Usado se nao houver preco por chapa"><NullableDecimalInput value={editing.pricePerKg} onCommit={(n) => setEditing({ ...editing, pricePerKg: n })} className={inputCls} aria-label="Preco por kg da chapa" /></Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} onClick={save}><Save size={16} /> Salvar</button>
            <button className={btnGhost} onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secao: Maquinas de Corte
// ---------------------------------------------------------------------------
const emptyCutting = (): CuttingMachineConfig => ({ id: genId(), name: '', type: 'laser', hourlyRateBrl: 300, setupTimeMinPerJob: 10, bands: defaultBandsFor('laser') });

const CuttingSection: React.FC<{ machines: CuttingMachineConfig[]; onChanged: () => void }> = ({ machines, onChanged }) => {
  const [editing, setEditing] = useState<CuttingMachineConfig | null>(null);

  const bandsContiguous = (bands: CuttingSpeedBand[]): string | null => {
    for (const b of bands) {
      if (!(b.thicknessMaxMm > b.thicknessMinMm)) return 'Cada faixa precisa ter espessura maxima maior que a minima.';
    }
    for (let i = 1; i < bands.length; i++) {
      if (Math.abs(bands[i].thicknessMinMm - bands[i - 1].thicknessMaxMm) > 1e-6) {
        return 'As faixas precisam ser contiguas (o fim de uma e o inicio da proxima), sem buracos nem sobreposicao.';
      }
    }
    return null;
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { showToast('Informe o nome da maquina.', 'error'); return; }
    const err = bandsContiguous(editing.bands);
    if (err) { showToast(err, 'error'); return; }
    await configStore.saveCuttingMachine(editing);
    setEditing(null); onChanged();
    showToast('Maquina de corte salva.', 'success');
  };
  const remove = async (m: CuttingMachineConfig) => { if (confirm(`Apagar a maquina "${m.name}"?`)) { await configStore.deleteCuttingMachine(m.id); onChanged(); } };

  const setBand = (i: number, patch: Partial<CuttingSpeedBand>) => {
    if (!editing) return;
    const bands = editing.bands.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    setEditing({ ...editing, bands });
  };
  const addBand = () => {
    if (!editing) return;
    const last = editing.bands[editing.bands.length - 1];
    const start = last ? last.thicknessMaxMm : 0.5;
    setEditing({ ...editing, bands: [...editing.bands, { thicknessMinMm: start, thicknessMaxMm: start + 2, speedAtMinMmPerMin: 3000, speedAtMaxMmPerMin: 2000, pierceAtMinSec: 0.5, pierceAtMaxSec: 1.0 }] });
  };
  const removeBand = (i: number) => { if (!editing) return; setEditing({ ...editing, bands: editing.bands.filter((_, idx) => idx !== i) }); };

  return (
    <div className="space-y-4">
      <button className={btnPrimary} onClick={() => setEditing(emptyCutting())}><Plus size={16} /> Nova maquina de corte</button>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2">Maquina</th><th className="text-left px-4 py-2">Tipo</th><th className="text-right px-4 py-2">R$/hora</th><th className="text-right px-4 py-2">Setup</th><th className="text-right px-4 py-2">Faixas</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {machines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nenhuma maquina de corte cadastrada.</td></tr>}
            {machines.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{m.name}</td>
                <td className="px-4 py-2 text-slate-500 uppercase">{m.type}</td>
                <td className="px-4 py-2 text-right">R$ {m.hourlyRateBrl.toFixed(2)}</td>
                <td className="px-4 py-2 text-right">{m.setupTimeMinPerJob} min</td>
                <td className="px-4 py-2 text-right">{m.bands.length}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="text-slate-500 hover:text-slate-900 mr-3" onClick={() => setEditing({ ...m, bands: m.bands.map((b) => ({ ...b })) })}>Editar</button>
                  <button className="text-red-500 hover:text-red-700" onClick={() => remove(m)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={`${card} p-5`}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Nome"><input className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Tipo">
              <select className={inputCls} value={editing.type} onChange={(e) => { const type = e.target.value as 'laser' | 'plasma'; setEditing({ ...editing, type, bands: defaultBandsFor(type) }); }}>
                <option value="laser">Laser</option>
                <option value="plasma">Plasma</option>
              </select>
            </Field>
            <Field label="Custo por hora (BRL)"><DecimalInput value={editing.hourlyRateBrl} onCommit={(n) => setEditing({ ...editing, hourlyRateBrl: n })} step={10} min={0} maxFractionDigits={2} className={inputCls} aria-label="Custo por hora" /></Field>
            <Field label="Setup por lote (min)"><input type="number" className={inputCls} value={editing.setupTimeMinPerJob} onChange={(e) => setEditing({ ...editing, setupTimeMinPerJob: Number(e.target.value) })} /></Field>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">Faixas de espessura (velocidade e perfuracao interpolam dentro da faixa)</span>
              <button className={btnGhost} onClick={addBand}><Plus size={14} /> Faixa</button>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">Estes numeros sao ponto de partida. Calibre com os dados reais da sua maquina. As faixas devem ser contiguas (o fim de uma e o inicio da proxima).</p>
            <div className="space-y-2">
              {editing.bands.map((b, i) => (
                <div key={i} className="grid grid-cols-7 gap-2 items-end bg-slate-50 rounded-lg p-2">
                  <Field label="Esp. min"><input type="number" step="0.1" className={inputCls} value={b.thicknessMinMm} onChange={(e) => setBand(i, { thicknessMinMm: Number(e.target.value) })} /></Field>
                  <Field label="Esp. max"><input type="number" step="0.1" className={inputCls} value={b.thicknessMaxMm} onChange={(e) => setBand(i, { thicknessMaxMm: Number(e.target.value) })} /></Field>
                  <Field label="Vel. min"><input type="number" className={inputCls} value={b.speedAtMinMmPerMin} onChange={(e) => setBand(i, { speedAtMinMmPerMin: Number(e.target.value) })} /></Field>
                  <Field label="Vel. max"><input type="number" className={inputCls} value={b.speedAtMaxMmPerMin} onChange={(e) => setBand(i, { speedAtMaxMmPerMin: Number(e.target.value) })} /></Field>
                  <Field label="Furo min (s)"><input type="number" step="0.1" className={inputCls} value={b.pierceAtMinSec} onChange={(e) => setBand(i, { pierceAtMinSec: Number(e.target.value) })} /></Field>
                  <Field label="Furo max (s)"><input type="number" step="0.1" className={inputCls} value={b.pierceAtMaxSec} onChange={(e) => setBand(i, { pierceAtMaxSec: Number(e.target.value) })} /></Field>
                  <button className="text-red-500 hover:text-red-700 pb-2 justify-self-center" onClick={() => removeBand(i)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} onClick={save}><Save size={16} /> Salvar</button>
            <button className={btnGhost} onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Secao: Maquinas de Dobra
// ---------------------------------------------------------------------------
const emptyBending = (): BendingMachineConfig => ({ id: genId(), name: '', hourlyRateBrl: 200, setupTimeMinPerJob: 15, cycleTimeSecPerBend: 12, maxTonnageTons: 100 });

const BendingSection: React.FC<{ machines: BendingMachineConfig[]; onChanged: () => void }> = ({ machines, onChanged }) => {
  const [editing, setEditing] = useState<BendingMachineConfig | null>(null);
  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { showToast('Informe o nome da maquina.', 'error'); return; }
    await configStore.saveBendingMachine(editing);
    setEditing(null); onChanged();
    showToast('Prensa dobradeira salva.', 'success');
  };
  const remove = async (m: BendingMachineConfig) => { if (confirm(`Apagar a maquina "${m.name}"?`)) { await configStore.deleteBendingMachine(m.id); onChanged(); } };

  return (
    <div className="space-y-4">
      <button className={btnPrimary} onClick={() => setEditing(emptyBending())}><Plus size={16} /> Nova prensa dobradeira</button>
      <div className={`${card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr><th className="text-left px-4 py-2">Maquina</th><th className="text-right px-4 py-2">R$/hora</th><th className="text-right px-4 py-2">Setup</th><th className="text-right px-4 py-2">Tempo/dobra</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {machines.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Nenhuma prensa dobradeira cadastrada.</td></tr>}
            {machines.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{m.name}</td>
                <td className="px-4 py-2 text-right">R$ {m.hourlyRateBrl.toFixed(2)}</td>
                <td className="px-4 py-2 text-right">{m.setupTimeMinPerJob} min</td>
                <td className="px-4 py-2 text-right">{m.cycleTimeSecPerBend} s</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button className="text-slate-500 hover:text-slate-900 mr-3" onClick={() => setEditing({ ...m })}>Editar</button>
                  <button className="text-red-500 hover:text-red-700" onClick={() => remove(m)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={`${card} p-5`}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Field label="Nome"><input className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Custo por hora (BRL)"><DecimalInput value={editing.hourlyRateBrl} onCommit={(n) => setEditing({ ...editing, hourlyRateBrl: n })} step={10} min={0} maxFractionDigits={2} className={inputCls} aria-label="Custo por hora" /></Field>
            <Field label="Setup por lote (min)"><input type="number" className={inputCls} value={editing.setupTimeMinPerJob} onChange={(e) => setEditing({ ...editing, setupTimeMinPerJob: Number(e.target.value) })} /></Field>
            <Field label="Tempo por dobra (s)"><DecimalInput value={editing.cycleTimeSecPerBend} onCommit={(n) => setEditing({ ...editing, cycleTimeSecPerBend: n })} step={1} min={0} maxFractionDigits={1} className={inputCls} aria-label="Tempo por dobra" /></Field>
            <Field label="Tonelagem maxima (t)"><DecimalInput value={editing.maxTonnageTons ?? 0} onCommit={(n) => setEditing({ ...editing, maxTonnageTons: n })} step={10} min={0} maxFractionDigits={0} className={inputCls} aria-label="Tonelagem maxima" /></Field>
          </div>
          <div className="mt-4 flex gap-2">
            <button className={btnPrimary} onClick={save}><Save size={16} /> Salvar</button>
            <button className={btnGhost} onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};
