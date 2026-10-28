// DXFAST :: Quotation Panel Component (Engineering Studio Workspace)
// Consumes live calculated geometry metrics and shop floor configurations from configStore.
// Outside src/engine/, strictly NO em-dash in strings. Brazilian Portuguese UI.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calculator,
  Flame,
  FoldHorizontal,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Settings,
  Layers,
  ArrowRight,
  TrendingUp,
  Clock,
  Coins,
  FileDown,
} from 'lucide-react';
import { GeometryResult, TemplateDefinition } from '../../types/cad';
import { AppAdminConfig, ClientInfo } from '../../types/admin';
import { configStore } from '../../data/store/configStore';
import { sessionStore } from '../../data/store/sessionStore';
import { showToast } from '../ui/toast';
import { DecimalInput } from '../ui/DecimalInput';
import { quoteHistoryStore } from '../../data/store/quoteHistoryStore';
import { computeQuote } from '../../quote/quoteEngine';
import { nestShape } from '../../quote/nesting';
import { QuoteResult } from '../../quote/quoteTypes';
import { NestingPreview } from './NestingPreview';
import { tessellatePart } from './partOutline';
// generateProposalPdf é carregado sob demanda (dynamic import) para manter jsPDF fora do bundle inicial.

interface QuotePanelProps {
  geometry: GeometryResult;
  params: Record<string, number>;
  features: Record<string, any>;
  template: TemplateDefinition;
  partName: string;
  onNavigateToAdmin?: () => void;
}

export const QuotePanel: React.FC<QuotePanelProps> = ({
  geometry,
  params,
  features,
  template,
  partName,
  onNavigateToAdmin,
}) => {
  const [config, setConfig] = useState<AppAdminConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);

  // User selections
  const [selectedCuttingId, setSelectedCuttingId] = useState<string>('');
  const [selectedBendingId, setSelectedBendingId] = useState<string>('');
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  // Buffer de texto para permitir apagar o digito enquanto digita (volta a 1 ao sair vazio).
  const [quantityText, setQuantityText] = useState<string>('1');
  const [marginPercent, setMarginPercent] = useState<number>(20);
  const [gapMm, setGapMm] = useState<number>(5);
  // Dados do cliente para a proposta (lembrados entre sessoes).
  const [client, setClient] = useState<ClientInfo>(() => sessionStore.loadClient() || {});
  useEffect(() => { sessionStore.saveClient(client); }, [client]);

  // Load config asynchronously on mount
  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        setIsLoadingConfig(true);
        const data = await configStore.getConfig();
        if (isMounted) {
          setConfig(data);
          // Set sensible defaults if available
          if (data.cuttingMachines.length > 0 && !selectedCuttingId) {
            setSelectedCuttingId(data.cuttingMachines[0].id);
          }
          if (data.bendingMachines.length > 0 && !selectedBendingId) {
            setSelectedBendingId(data.bendingMachines[0].id);
          }
          if (data.sheets.length > 0 && !selectedSheetId) {
            // Find sheet matching current thickness if possible
            const thk = params.thickness ?? 3.0;
            const matching = data.sheets.find((s) => Math.abs(s.thicknessMm - thk) < 0.1);
            setSelectedSheetId(matching ? matching.id : data.sheets[0].id);
          }
        }
      } catch (err) {
        console.error('Falha ao carregar configurações de orçamento:', err);
      } finally {
        if (isMounted) {
          setIsLoadingConfig(false);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  // Material map for rapid density lookup
  const materialsMap = useMemo(() => {
    if (!config) return new Map();
    return new Map(config.materials.map((m) => [m.id, m]));
  }, [config]);

  // Selected entities
  const selectedCuttingMachine = useMemo(() => {
    return config?.cuttingMachines.find((m) => m.id === selectedCuttingId) || null;
  }, [config, selectedCuttingId]);

  const selectedBendingMachine = useMemo(() => {
    return config?.bendingMachines.find((m) => m.id === selectedBendingId) || null;
  }, [config, selectedBendingId]);

  const selectedSheet = useMemo(() => {
    return config?.sheets.find((s) => s.id === selectedSheetId) || null;
  }, [config, selectedSheetId]);

  // Material associated with selected sheet
  const selectedMaterial = useMemo(() => {
    if (!selectedSheet) return null;
    return materialsMap.get(selectedSheet.materialId) || null;
  }, [selectedSheet, materialsMap]);

  // Active thickness
  const thicknessMm = params.thickness ?? 3.0;
  const hasGeometryErrors = Boolean(geometry.errors && geometry.errors.length > 0);

  // Silhueta externa da peça (para o encaixe aos pares no aninhamento).
  const partOuterLoops = useMemo(() => {
    try {
      return tessellatePart(geometry).outer;
    } catch {
      return undefined;
    }
  }, [geometry]);

  // Compute quote reactively
  // Aninhamento da peca na chapa: parte pesada, recalculada so quando muda a
  // chapa, a geometria do blank, o espacamento ou a silhueta (nao com margem/qtd).
  const partNesting = useMemo(() => {
    if (!selectedSheet) return undefined;
    return nestShape(
      selectedSheet.widthMm,
      selectedSheet.lengthMm,
      geometry.metrics.blankWidthMm,
      geometry.metrics.blankHeightMm,
      gapMm,
      partOuterLoops
    );
  }, [selectedSheet, geometry.metrics.blankWidthMm, geometry.metrics.blankHeightMm, gapMm, partOuterLoops]);

  const quoteOutcome = useMemo(() => {
    if (!config || !selectedCuttingMachine || !selectedSheet) {
      return null;
    }

    return computeQuote({
      metrics: geometry.metrics,
      thicknessMm,
      cuttingMachine: selectedCuttingMachine,
      bendingMachine: selectedBendingMachine,
      sheet: selectedSheet,
      materialDensityGPerCm3: selectedMaterial?.densityGPerCm3,
      quantity,
      marginPercent,
      gapMm,
      hasGeometryErrors,
      partOuterLoops,
      precomputedNesting: partNesting,
    });
  }, [
    config,
    geometry.metrics,
    thicknessMm,
    selectedCuttingMachine,
    selectedBendingMachine,
    selectedSheet,
    selectedMaterial,
    partNesting,
    quantity,
    marginPercent,
    gapMm,
    hasGeometryErrors,
    partOuterLoops,
  ]);

  // Trigger Commercial Proposal PDF Generation
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleGenerateProposal = useCallback(async () => {
    if (!quoteOutcome || quoteOutcome.blocked) return;

    try {
      setIsGeneratingPdf(true);
      const companyConfig = await configStore.getCompany();
      const materialDisplayName = selectedMaterial?.name || selectedMaterial?.code || 'Aço Industrial';

      const { generateProposalPdf } = await import('../../quote/proposalPdf');
      generateProposalPdf({
        company: companyConfig,
        quote: quoteOutcome,
        partName,
        template,
        geometry,
        params,
        thicknessMm,
        materialName: materialDisplayName,
        client,
      });
      // Registra no historico de orcamentos (item 2)
      try {
        quoteHistoryStore.add({
          kind: 'single',
          clientName: client.name,
          total: quoteOutcome.totalPrice,
          itemCount: quoteOutcome.quantity,
          single: {
            design: { templateId: template.id, params: { ...params }, features: JSON.parse(JSON.stringify(features || {})) },
            partName,
            thicknessMm,
          },
        });
      } catch { /* historico e best-effort */ }
      showToast('Proposta comercial (PDF) gerada.', 'success');
    } catch (err) {
      console.error('Erro ao gerar proposta comercial em PDF:', err);
      showToast('Nao foi possivel gerar a proposta em PDF.', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [
    quoteOutcome,
    selectedMaterial,
    partName,
    template,
    geometry,
    params,
    features,
    thicknessMm,
    client,
  ]);

  if (isLoadingConfig) {
    return (
      <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex items-center justify-center py-10">
        <div className="flex items-center gap-3 text-slate-500 font-mono text-xs">
          <div className="w-5 h-5 border-2 border-[#FF3000] border-t-transparent rounded-full animate-spin" />
          <span>Carregando parâmetros de orçamento fabril...</span>
        </div>
      </div>
    );
  }

  // Estado Vazio: se não houver máquinas ou chapas cadastradas
  const hasNoMachinesOrSheets =
    !config ||
    config.cuttingMachines.length === 0 ||
    config.sheets.length === 0;

  if (hasNoMachinesOrSheets) {
    return (
      <section className="w-full bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-[#FF3000] flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 font-heading">
              Motor de Orçamento e Custos Industriais
            </h2>
            <p className="text-xs text-slate-500 font-sans">
              Precificação analítica por tempo de máquina, consumo de matéria-prima e conformação CNC.
            </p>
          </div>
        </div>

        <div className="py-8 flex flex-col items-center text-center max-w-md mx-auto space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 font-heading">
              Parâmetros Fabris Necessários
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Para calcular orçamentos instantâneos com tempos de máquina e aproveitamento de chapa, é necessário cadastrar ao menos uma máquina de corte e uma chapa de matéria-prima no Painel Administrativo.
            </p>
          </div>
          {onNavigateToAdmin && (
            <button
              onClick={onNavigateToAdmin}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#FF3000] hover:bg-[#e62b00] text-white rounded-xl text-xs font-semibold shadow-xs transition active:scale-95"
            >
              <span>Acessar Painel Administrativo</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </section>
    );
  }

  const bendCount = geometry.metrics.bendCount || 0;

  return (
    <section className="w-full bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-7 shadow-xs space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-[#FF3000] flex items-center justify-center shrink-0">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 font-heading">
                Orçamento e Formação de Preço
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700">
                TEMPO DE MÁQUINA
              </span>
            </div>
            <p className="text-xs text-slate-500 font-sans">
              Cálculo analítico para peça única ou lotes: matéria-prima, corte CNC, dobra e overhead.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Dados do cliente (vao impressos na proposta) */}
          <input
            value={client.name || ''}
            onChange={(e) => setClient((c) => ({ ...c, name: e.target.value }))}
            placeholder="Cliente (nome)"
            className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]"
            aria-label="Nome do cliente"
          />
          <input
            value={client.contact || ''}
            onChange={(e) => setClient((c) => ({ ...c, contact: e.target.value }))}
            placeholder="Contato"
            className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]"
            aria-label="Contato do cliente"
          />
          {/* Botao de Geracao de Proposta Comercial em PDF */}
          <button
            id="btn-generate-proposal-pdf"
            onClick={handleGenerateProposal}
            disabled={!quoteOutcome || quoteOutcome.blocked || isGeneratingPdf}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition active:scale-95 ${
              !quoteOutcome || quoteOutcome.blocked
                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                : 'bg-[#FF3000] hover:bg-[#e62b00] text-white border border-[#FF3000]'
            }`}
            title={
              !quoteOutcome || quoteOutcome.blocked
                ? `Proposta comercial bloqueada: ${quoteOutcome?.reason || 'Corrija os parâmetros para calcular o orçamento'}`
                : 'Gerar e baixar Proposta Comercial em PDF (A4 para o Cliente)'
            }
          >
            <FileDown className="w-4 h-4" />
            <span>{isGeneratingPdf ? 'Gerando...' : 'Gerar Proposta (PDF)'}</span>
          </button>

          {onNavigateToAdmin && (
            <button
              onClick={onNavigateToAdmin}
              className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-semibold transition"
              title="Ajustar custos hora, máquinas ou chapas no painel admin"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              <span>Configurar Custos Fabris</span>
            </button>
          )}
        </div>
      </div>

      {/* Barra de Controles e Seletores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5 p-4 bg-slate-50 border border-slate-200/80 rounded-xl text-xs">
        {/* Máquina de Corte */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-[#FF3000]" />
            <span>Máquina de Corte *</span>
          </label>
          <select
            value={selectedCuttingId}
            onChange={(e) => setSelectedCuttingId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-[#FF3000]"
          >
            {config.cuttingMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.type.toUpperCase()}) (R$ {m.hourlyRateBrl}/h)
              </option>
            ))}
          </select>
        </div>

        {/* Chapa de Matéria-Prima */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
            <span>Chapa em Estoque *</span>
          </label>
          <select
            value={selectedSheetId}
            onChange={(e) => setSelectedSheetId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-[#FF3000]"
          >
            {config.sheets.map((s) => {
              const mat = materialsMap.get(s.materialId);
              return (
                <option key={s.id} value={s.id}>
                  {mat?.code || 'Chapa'} #{s.thicknessMm}mm ({s.widthMm}x{s.lengthMm}mm)
                </option>
              );
            })}
          </select>
        </div>

        {/* Máquina de Dobra (se aplicável) */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
            <FoldHorizontal className="w-3.5 h-3.5 text-amber-600" />
            <span>Dobradeira CNC {bendCount > 0 ? '*' : '(Opcional)'}</span>
          </label>
          <select
            value={selectedBendingId}
            onChange={(e) => setSelectedBendingId(e.target.value)}
            disabled={bendCount === 0 && config.bendingMachines.length === 0}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:border-[#FF3000] disabled:bg-slate-100 disabled:text-slate-400"
          >
            {bendCount === 0 && <option value="">Sem dobras na peça (dispensada)</option>}
            {config.bendingMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.maxTonnageTons ? ` (${m.maxTonnageTons}T)` : ''} (R$ {m.hourlyRateBrl}/h)
              </option>
            ))}
          </select>
        </div>

        {/* Quantidade do Lote */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1">
            Quantidade do Lote (peças)
          </label>
          <input
            type="number"
            min={1}
            max={100000}
            inputMode="numeric"
            value={quantityText}
            onChange={(e) => {
              const v = e.target.value;
              setQuantityText(v);
              if (v !== '' && /^\d+$/.test(v)) {
                const n = Math.min(100000, parseInt(v, 10));
                if (n >= 1) setQuantity(n);
              }
            }}
            onBlur={() => {
              const n = parseInt(quantityText, 10);
              if (!(n >= 1)) { setQuantityText('1'); setQuantity(1); }
              else { const c = Math.min(100000, n); setQuantityText(String(c)); setQuantity(c); }
            }}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#FF3000]"
          />
        </div>

        {/* Margem de Lucro / Markup */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1">
            Margem / Markup (%)
          </label>
          <div className="flex items-center gap-1.5">
            <DecimalInput
              value={marginPercent}
              onCommit={(n) => setMarginPercent(Math.max(0, n))}
              step={1}
              min={0}
              max={500}
              maxFractionDigits={2}
              aria-label="Margem ou markup em porcentagem"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#FF3000]"
            />
            <span className="text-slate-500 font-mono font-bold">%</span>
          </div>
        </div>

        {/* Espaçamento entre Peças (Gap) + margem de borda */}
        <div className="lg:col-span-2">
          <label className="block text-slate-700 font-semibold mb-1">
            Espaçamento / Margem (mm)
          </label>
          <div className="flex items-center gap-1.5">
            <DecimalInput
              value={gapMm}
              onCommit={(n) => setGapMm(Math.min(20, Math.max(1, n)))}
              step={1}
              min={1}
              max={20}
              maxFractionDigits={1}
              aria-label="Espacamento entre pecas em milimetros"
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:border-[#FF3000]"
            />
            <span className="text-slate-500 font-mono">mm</span>
          </div>
        </div>
      </div>

      {/* Aviso não-bloqueante de divergência de espessura */}
      {quoteOutcome && !quoteOutcome.blocked && quoteOutcome.thicknessMismatchWarning && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{quoteOutcome.thicknessMismatchWarning}</span>
        </div>
      )}

      {/* Bloqueio Honesto */}
      {quoteOutcome && quoteOutcome.blocked && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-xs text-red-800">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-red-900">Orçamento não pôde ser calculado</h4>
            <p className="mt-0.5 leading-relaxed">{quoteOutcome.reason}</p>
          </div>
        </div>
      )}

      {/* Exibição Completa do Resultado */}
      {quoteOutcome && !quoteOutcome.blocked && (
        <div className="space-y-5">
          {/* Destaque Comercial: Preço Unitário e Preço Total */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl shadow-md">
            <div className="flex flex-col justify-between">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Preço de Venda Unitário
                </span>
                <div className="text-3xl font-black font-mono text-[#FF3000] mt-1">
                  R$ {quoteOutcome.unitPrice.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-300 mt-1 font-mono">
                  Custo base: R$ {quoteOutcome.unitBeforeMargin.toFixed(2)} (+{quoteOutcome.marginPercent}% margem)
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-700/60 font-mono">
                {quantity === 1 ? 'Orçamento para Peça Única (setup 100% alocado)' : `Lote de ${quantity} peças (setup diluído)`}
              </div>
            </div>

            <div className="flex flex-col justify-between md:border-l md:border-slate-700/60 md:pl-5">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Valor Total do Pedido
                </span>
                <div className="text-3xl font-black font-mono text-emerald-400 mt-1">
                  R$ {quoteOutcome.totalPrice.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-300 mt-1 font-mono">
                  Volume de {quantity} unidade(s)
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-700/60 text-[11px] font-mono">
                <div>
                  <span className="text-slate-400 block">Custo Variável/Peça</span>
                  <span className="text-slate-200 font-bold">R$ {quoteOutcome.variableCostPerPiece.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Custo Fixo do Lote</span>
                  <span className="text-slate-200 font-bold">R$ {quoteOutcome.fixedCostPerLot.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quatro Blocos de Detalhamento Industrial */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Bloco 1: Matéria-Prima */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>Matéria-Prima</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  R$ {quoteOutcome.material.materialCostPerPiece.toFixed(2)}/pç
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span>Peças por Chapa:</span>
                  <strong className="text-slate-900">{quoteOutcome.material.piecesPerSheet} un</strong>
                </div>
                <div className="flex justify-between">
                  <span>Aproveitamento:</span>
                  <strong className="text-slate-900">{quoteOutcome.material.sheetUtilizationPercent.toFixed(1)}%</strong>
                </div>
                <div className="flex justify-between">
                  <span>Chapa Efetiva:</span>
                  <span>R$ {quoteOutcome.material.effectiveSheetPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Chapas p/ Lote:</span>
                  <span>{quoteOutcome.material.sheetsNeeded} un</span>
                </div>
              </div>
            </div>

            {/* Bloco 2: Corte CNC */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#FF3000]" />
                  <span>Corte ({selectedCuttingMachine?.type.toUpperCase()})</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  R$ {quoteOutcome.cutting.cutCostPerPiece.toFixed(2)}/pç
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span>Velocidade:</span>
                  <strong className="text-slate-900">{quoteOutcome.cutting.speedMmPerMin} mm/min</strong>
                </div>
                <div className="flex justify-between">
                  <span>Tempo de Corte:</span>
                  <strong className="text-slate-900">{(quoteOutcome.cutting.cutTimeMinPerPiece * 60).toFixed(1)} s</strong>
                </div>
                <div className="flex justify-between">
                  <span>Perfuração:</span>
                  <span>{quoteOutcome.cutting.pierceTimeSec} s/furo</span>
                </div>
                <div className="flex justify-between">
                  <span>Setup do Lote:</span>
                  <span>R$ {quoteOutcome.cutting.cutSetupLotCost.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Bloco 3: Dobra CNC */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <FoldHorizontal className="w-3.5 h-3.5 text-amber-600" />
                  <span>Dobra CNC</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {bendCount > 0 ? `R$ ${quoteOutcome.bending.bendCostPerPiece.toFixed(2)}/pç` : 'R$ 0.00'}
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span>Golpes de Dobra:</span>
                  <strong className="text-slate-900">{bendCount} dobra(s)</strong>
                </div>
                <div className="flex justify-between">
                  <span>Tempo por Peça:</span>
                  <strong className="text-slate-900">{quoteOutcome.bending.bendTimeSecPerPiece.toFixed(1)} s</strong>
                </div>
                <div className="flex justify-between">
                  <span>Setup da Dobra:</span>
                  <span>R$ {quoteOutcome.bending.bendSetupLotCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Hora da Máquina:</span>
                  <span>R$ {selectedBendingMachine?.hourlyRateBrl || 0}/h</span>
                </div>
              </div>
            </div>

            {/* Bloco 4: Setup & Margem */}
            <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Setup & Markup</span>
                </span>
                <span className="font-mono font-bold text-emerald-700">
                  +{quoteOutcome.marginPercent}%
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span>Setup Fixo Total:</span>
                  <strong className="text-slate-900">R$ {quoteOutcome.fixedCostPerLot.toFixed(2)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Setup por Peça:</span>
                  <strong className="text-slate-900">R$ {(quoteOutcome.fixedCostPerLot / quantity).toFixed(2)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Custo sem Margem:</span>
                  <span>R$ {quoteOutcome.unitBeforeMargin.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Lucro Unitário:</span>
                  <span className="text-emerald-700 font-bold">
                    R$ {(quoteOutcome.unitPrice - quoteOutcome.unitBeforeMargin).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Preview visual do aninhamento real na chapa (geometria real da peça) */}
          <NestingPreview material={quoteOutcome.material} geometry={geometry} />
        </div>
      )}
    </section>
  );
};
