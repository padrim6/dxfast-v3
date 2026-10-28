import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { TEMPLATES } from './data/templates';
import { TemplateDefinition, FeatureId, FeatureState, GeometryResult } from './types/cad';
import { generateGeometry } from './engine/geometryEngine';
import { parseDxf } from './import/dxfParser';
import { buildGeometryFromDxf, ImportReport } from './import/dxfToGeometry';
import { makeImportedTemplate } from './import/importedTemplate';
import { ImportedPartPanel } from './components/ImportedPartPanel';
import { CartView } from './components/cart/CartView';
import { CartItem } from './quote/cartQuote';
import { useDesignHistory } from './hooks/useDesignHistory';
import { exportDesign, pickProjectFile, DesignSnapshot } from './utils/projectIO';
// Exportadores carregados sob demanda (dynamic import nos handlers) para manter
// jsPDF, html2canvas e three fora do bundle inicial.
import { Header } from './components/Header';
import { TemplateCatalog } from './components/TemplateCatalog';
import { CadViewport } from './components/CadViewport';
import { TechnicalSpecsPanel } from './components/TechnicalSpecsPanel';
import { ConfiguratorPanel } from './components/ConfiguratorPanel';
import { CadErrorBoundary } from './components/CadErrorBoundary';
import { AdminPanel } from './components/admin/AdminPanel';
import { QuotePanel } from './components/quote/QuotePanel';
import { useDebounce } from './hooks/useDebounce';
import { sessionStore } from './data/store/sessionStore';
import { Toaster, showToast } from './components/ui/toast';
import { presetStore, ParamPreset } from './data/store/presetStore';
import { quoteHistoryStore, QuoteHistoryRecord } from './data/store/quoteHistoryStore';
import { HistoryView } from './components/history/HistoryView';

export default function App() {
  // Navigation Environment: 'library' | 'workspace' | 'admin' | 'cart'
  const [activeScreen, setActiveScreen] = useState<'library' | 'workspace' | 'admin' | 'cart' | 'history'>('library');

  // Carrinho de corte (lote de pecas variadas)
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Currently active template (Defaults to Perfil U)
  const [currentTemplate, setCurrentTemplate] = useState<TemplateDefinition>(TEMPLATES[0]);

  // Template Parameters
  const [params, setParams] = useState<Record<string, number>>(() => ({
    ...TEMPLATES[0].defaultParams,
  }));

  // Features State (fillet, chamfer, cornerHoles, etc.)
  const [features, setFeatures] = useState<Record<FeatureId, FeatureState>>(() => ({
    ...TEMPLATES[0].defaultFeatures,
  }));

  // Part Name / Code
  const [partName, setPartName] = useState<string>('Perfil "U"');

  // Presets de parametros por template (item 10)
  const [presets, setPresets] = useState<ParamPreset[]>([]);
  const [presetName, setPresetName] = useState<string>('');

  // Imported DXF part (free geometry, no parameters). When set, it overrides the
  // generated geometry and the workspace runs in "imported" mode.
  const [importedGeometry, setImportedGeometry] = useState<GeometryResult | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importedThickness, setImportedThickness] = useState<number>(3);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Marca quando a sessao salva ja foi restaurada, para nao gravar por cima antes da hora.
  const restoredRef = useRef<boolean>(false);

  // Handle template selection from Library
  const handleSelectTemplate = useCallback((template: TemplateDefinition) => {
    setImportedGeometry(null); // sai do modo importado
    setImportReport(null);
    setCurrentTemplate(template);
    setParams({ ...template.defaultParams });
    setFeatures({ ...template.defaultFeatures });

    // Direct, clean template name without clutter
    setPartName(template.name);

    // Switch to workspace view
    setActiveScreen('workspace');
  }, []);

  // Importa um arquivo DXF: faz o parse, monta a geometria e entra no modo importado.
  const handleImportDxf = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseDxf(text);
      const { geometry: geom, report } = buildGeometryFromDxf(parsed);
      if (report.outerCount === 0) {
        showToast('Nenhum contorno de corte fechado foi reconhecido neste DXF. Verifique se o arquivo contem a geometria em polylines ou linhas fechadas.', 'error');
        return;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '') || 'Peca Importada';
      setImportedGeometry(geom);
      setImportReport(report);
      setPartName(baseName);
      setActiveScreen('workspace');
      showToast(`DXF importado: ${baseName}`, 'success');
    } catch (err) {
      console.error('Falha ao importar DXF:', err);
      showToast('Nao foi possivel ler este arquivo DXF.', 'error');
    }
  }, []);

  // Update a single base parameter
  const handleParamChange = useCallback((key: string, value: number) => {
    setParams((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // Toggle a feature on/off with intelligent mutual exclusivity
  const handleFeatureToggle = useCallback((featureId: FeatureId, enabled: boolean) => {
    setFeatures((prev) => {
      const next = { ...prev };

      next[featureId] = {
        ...(prev[featureId] || { params: {} }),
        enabled,
      };

      // Mutual exclusivity rules
      if (enabled) {
        // 1. Fillet vs Chamfer
        if (featureId === 'fillet' && next.chamfer?.enabled) {
          next.chamfer = { ...next.chamfer, enabled: false };
        } else if (featureId === 'chamfer' && next.fillet?.enabled) {
          next.fillet = { ...next.fillet, enabled: false };
        }

        // 2. Corner Holes vs Corner Slotted Holes
        if (featureId === 'slottedHoles') {
          const slotPattern = next.slottedHoles?.params?.pattern || 'corners';
          if (slotPattern === 'corners' && next.cornerHoles?.enabled) {
            next.cornerHoles = { ...next.cornerHoles, enabled: false };
          }
        } else if (featureId === 'cornerHoles') {
          const slotPattern = next.slottedHoles?.params?.pattern || 'corners';
          if (next.slottedHoles?.enabled && slotPattern === 'corners') {
            next.slottedHoles = { ...next.slottedHoles, enabled: false };
          }
        }

        // 3. Keyway requires Center Hole
        if (featureId === 'keyway') {
          if (!next.centerHole?.enabled) {
            next.centerHole = {
              enabled: true,
              params: { diameter: Math.max(30, Number(next.centerHole?.params?.diameter || 40)) },
            };
          }
        }
      } else {
        // Disabling features
        if (featureId === 'centerHole' && next.keyway?.enabled) {
          next.keyway = { ...next.keyway, enabled: false };
        }
      }

      return next;
    });
  }, []);

  // Update feature specific parameters with dynamic mutual exclusivity checks
  const handleFeatureParamChange = useCallback((featureId: FeatureId, paramKey: string, value: any) => {
    setFeatures((prev) => {
      const next = { ...prev };
      const currentFeat = prev[featureId] || { enabled: false, params: {} };

      next[featureId] = {
        ...currentFeat,
        params: {
          ...currentFeat.params,
          [paramKey]: value,
        },
      };

      // If user switches slotted holes pattern to 'corners' while corner holes is enabled
      if (featureId === 'slottedHoles' && paramKey === 'pattern' && value === 'corners') {
        if (next.cornerHoles?.enabled) {
          next.cornerHoles = { ...next.cornerHoles, enabled: false };
        }
      }

      return next;
    });
  }, []);

  // ---- Projeto: snapshot do design, aplicar, histórico (undo/redo), salvar/abrir ----
  const designSnapshot = useMemo<DesignSnapshot>(
    () => ({ templateId: currentTemplate.id, partName, params, features }),
    [currentTemplate.id, partName, params, features]
  );

  const applyDesign = useCallback(
    (s: DesignSnapshot) => {
      const tpl = TEMPLATES.find((t) => t.id === s.templateId) || currentTemplate;
      // Carregar um design parametrico sempre sai do modo importado: do contrario
      // a tela ficaria presa mostrando o DXF importado e o design novo ficaria
      // invisivel (abrir projeto, reabrir historico, editar item, undo/redo).
      setImportedGeometry(null);
      setImportReport(null);
      setCurrentTemplate(tpl);
      setParams({ ...tpl.defaultParams, ...s.params });
      setFeatures({ ...tpl.defaultFeatures, ...s.features });
      setPartName(s.partName);
    },
    [currentTemplate]
  );

  const { undo, redo, reset: resetHistory, canUndo, canRedo } = useDesignHistory(designSnapshot, applyDesign);

  const handleSaveProject = useCallback(() => {
    exportDesign({ templateId: currentTemplate.id, partName, params, features });
    showToast('Projeto salvo em arquivo.', 'success');
  }, [currentTemplate.id, partName, params, features]);

  const handleOpenProject = useCallback(async () => {
    try {
      const design = await pickProjectFile();
      const tpl = TEMPLATES.find((t) => t.id === design.templateId);
      if (!tpl) {
        showToast(`O modelo "${design.templateId}" nao existe nesta versao do DXFAST.`, 'error');
        return;
      }
      applyDesign(design);
      resetHistory(design);
      setActiveScreen('workspace');
      showToast('Projeto aberto.', 'success');
    } catch (err: any) {
      if (err && err.message && err.message !== 'Nenhum arquivo selecionado.') {
        showToast(`Nao foi possivel abrir o projeto: ${err.message}`, 'error');
      }
    }
  }, [applyDesign, resetHistory]);

  // Restaura a sessao anterior (peca atual + carrinho + tela) ao abrir o app.
  useEffect(() => {
    const s = sessionStore.load();
    if (s) {
      if (s.design && TEMPLATES.find((t) => t.id === s.design!.templateId)) {
        applyDesign(s.design);
        resetHistory(s.design);
      }
      if (Array.isArray(s.cart)) setCartItems(s.cart);
      if (s.activeScreen === 'workspace' || s.activeScreen === 'cart' || s.activeScreen === 'admin' || s.activeScreen === 'library' || s.activeScreen === 'history') {
        setActiveScreen(s.activeScreen as any);
      }
    }
    restoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste a peca atual e a tela (debounce leve); barato de gravar.
  useEffect(() => {
    if (!restoredRef.current) return;
    const h = setTimeout(() => {
      sessionStore.saveDesign(activeScreen, { templateId: currentTemplate.id, partName, params, features });
    }, 400);
    return () => clearTimeout(h);
  }, [activeScreen, currentTemplate.id, partName, params, features]);

  // Persiste o carrinho so quando ele muda (evita re-serializar geometria a cada slider).
  useEffect(() => {
    if (!restoredRef.current) return;
    sessionStore.saveCart(cartItems);
  }, [cartItems]);

  // Atalhos de teclado: Ctrl/Cmd+Z desfaz, Ctrl/Cmd+Shift+Z ou Ctrl+Y refaz
  // (ignorados quando o foco está em um campo de texto, para não atrapalhar a digitação).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeScreen !== 'workspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeScreen, undo, redo]);

  // Debounce parameter changes during rapid slider interactions to amortize geometry & 3D rebuilds
  const debouncedParams = useDebounce(params, 75);
  const debouncedFeatures = useDebounce(features, 75);

  // Recalculation pending indicator: true while debounced values have not caught up with immediate UI values
  const isRecalculating =
    debouncedParams !== params ||
    debouncedFeatures !== features;

  // Calculate Geometry analytically with anti-error protections (Single Source of Truth)
  const generatedGeometry = useMemo(() => {
    return generateGeometry(currentTemplate, debouncedParams, debouncedFeatures);
  }, [currentTemplate, debouncedParams, debouncedFeatures]);

  const isImported = importedGeometry !== null;

  // Geometria efetiva: a importada (quando houver) tem prioridade sobre a gerada.
  const geometry = isImported ? importedGeometry! : generatedGeometry;

  // Template e parametros efetivos: no modo importado, um template sintetico de
  // chapa plana e a espessura escolhida pelo usuario.
  const importedTemplate = useMemo(
    () => makeImportedTemplate(partName, importedThickness),
    [partName, importedThickness]
  );
  const effectiveTemplate = isImported ? importedTemplate : currentTemplate;
  const effectiveParams = isImported ? { thickness: importedThickness } : debouncedParams;

  // Carrinho: adicionar a peca atual, editar quantidade, remover.
  const handleAddToCart = useCallback(() => {
    if (geometry.errors && geometry.errors.length > 0) {
      showToast('Corrija as inconsistencias geometricas antes de adicionar ao carrinho.', 'error');
      return;
    }
    const thickness = isImported ? importedThickness : (debouncedParams.thickness ?? 3);
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `item_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const itemName = partName.trim() || effectiveTemplate.name;
    const design = isImported
      ? undefined
      : { templateId: currentTemplate.id, params: { ...params }, features: JSON.parse(JSON.stringify(features)) };
    setCartItems((prev) => [
      ...prev,
      { id, name: itemName, geometry, thicknessMm: thickness, qty: 1, design },
    ]);
    showToast(`"${itemName}" adicionada ao carrinho.`, 'success');
  }, [geometry, isImported, importedThickness, debouncedParams, partName, effectiveTemplate, currentTemplate.id, params, features]);

  // Duplicar um item do carrinho (item 6)
  const handleDuplicateCartItem = useCallback((id: string) => {
    setCartItems((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const src = prev[idx];
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `item_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const copy = { ...src, id: newId, name: `${src.name} (copia)` };
      const next = prev.slice();
      next.splice(idx + 1, 0, copy);
      return next;
    });
    showToast('Item duplicado no carrinho.', 'success');
  }, []);

  // Editar um item do carrinho: recarrega o projeto parametrico no configurador (item 6)
  const handleEditCartItem = useCallback((id: string) => {
    const it = cartItems.find((x) => x.id === id);
    if (!it) return;
    if (!it.design) {
      showToast('Este item veio de um DXF importado e nao tem parametros para editar.', 'info');
      return;
    }
    const snap = { templateId: it.design.templateId, partName: it.name, params: it.design.params, features: it.design.features };
    applyDesign(snap);
    resetHistory(snap);
    // Remove o item do carrinho: editar e re-adicionar substitui, em vez de duplicar.
    setCartItems((prev) => prev.filter((x) => x.id !== id));
    setActiveScreen('workspace');
    showToast('Peca carregada no configurador. Ajuste e adicione novamente ao carrinho.', 'info');
  }, [cartItems, applyDesign, resetHistory]);

  // Presets de parametros por template (item 10)
  useEffect(() => {
    setPresets(presetStore.listForTemplate(currentTemplate.id));
  }, [currentTemplate.id]);

  const handleSavePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) { showToast('De um nome ao preset antes de salvar.', 'error'); return; }
    presetStore.save(currentTemplate.id, name, params, features);
    setPresets(presetStore.listForTemplate(currentTemplate.id));
    setPresetName('');
    showToast(`Preset "${name}" salvo.`, 'success');
  }, [presetName, currentTemplate.id, params, features]);

  const handleApplyPreset = useCallback((id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setParams({ ...currentTemplate.defaultParams, ...p.params });
    setFeatures({ ...currentTemplate.defaultFeatures, ...p.features } as Record<FeatureId, FeatureState>);
    showToast(`Preset "${p.name}" aplicado.`, 'success');
  }, [presets, currentTemplate]);

  const handleDeletePreset = useCallback((id: string) => {
    presetStore.remove(currentTemplate.id, id);
    setPresets(presetStore.listForTemplate(currentTemplate.id));
  }, [currentTemplate.id]);

  // Reabrir um orcamento do historico (item 2)
  const handleReopenHistory = useCallback((rec: QuoteHistoryRecord) => {
    if (rec.kind === 'cart' && rec.cart) {
      setCartItems(rec.cart.items);
      setActiveScreen('cart');
      showToast('Lote recarregado no carrinho.', 'success');
    } else if (rec.kind === 'single' && rec.single?.design) {
      const d = rec.single;
      const snap = { templateId: d.design!.templateId, partName: d.partName, params: d.design!.params, features: d.design!.features };
      applyDesign(snap); resetHistory(snap); setActiveScreen('workspace');
      showToast('Orcamento recarregado no configurador.', 'success');
    } else {
      showToast('Nao ha dados suficientes para reabrir este registro.', 'info');
    }
  }, [applyDesign, resetHistory]);

  const handleUpdateCartQty = useCallback((id: string, qty: number) => {
    setCartItems((prev) => prev.map((it) => (it.id === id ? { ...it, qty } : it)));
  }, []);
  const handleRemoveFromCart = useCallback((id: string) => {
    setCartItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  // Direct DXF export trigger with validation guard (guaranteed strictly identical to screen geometry)
  const handleExportDxf = useCallback(async () => {
    if (isRecalculating) return;
    if (geometry.errors && geometry.errors.length > 0) {
      showToast(
        `Exportacao DXF bloqueada. Corrija:\n${geometry.errors.map((e) => `- ${e.message}`).join('\n')}`,
        'error'
      );
      return;
    }
    const { generateDxfR2000, downloadDxfFile, DEFAULT_DXF_OPTIONS } = await import('./engine/dxfExporter');
    const rawDxf = generateDxfR2000(geometry, DEFAULT_DXF_OPTIONS);
    const filename = partName.trim() ? partName.trim() : `${effectiveTemplate.id}_${Date.now()}`;
    downloadDxfFile(filename, rawDxf);
    showToast('Arquivo DXF gerado.', 'success');
  }, [geometry, isRecalculating, partName, effectiveTemplate.id]);

  // Direct PDF technical drawing export trigger with validation guard (guaranteed strictly identical to screen geometry)
  const handleExportPdf = useCallback(async () => {
    if (isRecalculating) return;
    if (geometry.errors && geometry.errors.length > 0) {
      showToast(
        `Exportacao do desenho tecnico bloqueada. Corrija:\n${geometry.errors.map((e) => `- ${e.message}`).join('\n')}`,
        'error'
      );
      return;
    }

    const thk = effectiveParams.thickness ?? effectiveTemplate.defaultParams.thickness;
    if (thk === undefined || thk === null || isNaN(thk) || thk <= 0) {
      showToast(`Espessura da chapa nao definida para o modelo "${effectiveTemplate.name}".`, 'error');
      return;
    }

    const { downloadTechnicalDrawingPdf } = await import('./engine/pdfExporter');
    downloadTechnicalDrawingPdf(geometry, effectiveTemplate, {
      partName: partName.trim() || effectiveTemplate.name,
      thicknessMm: thk,
      params: effectiveParams,
    });
    showToast('Desenho tecnico (PDF) gerado.', 'success');
  }, [geometry, isRecalculating, effectiveTemplate, effectiveParams, partName]);

  const isExportBlocked = Boolean((geometry.errors && geometry.errors.length > 0) || isRecalculating);

  // Atalhos adicionais no workspace: Ctrl/Cmd+S salva projeto, Ctrl/Cmd+E exporta DXF.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeScreen !== 'workspace') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); handleSaveProject(); }
      else if (k === 'e') { e.preventDefault(); handleExportDxf(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeScreen, handleSaveProject, handleExportDxf]);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-100 text-slate-800 selection:bg-[#FF3000] selection:text-white">
      {/* Header adapts automatically to active mode */}
      <Header
        currentTemplate={effectiveTemplate}
        partName={partName}
        activeScreen={activeScreen}
        cartCount={cartItems.length}
        onNavigateToLibrary={() => setActiveScreen('library')}
        onNavigateToWorkspace={() => setActiveScreen('workspace')}
        onNavigateToAdmin={() => setActiveScreen('admin')}
        onNavigateToCart={() => setActiveScreen('cart')}
        onNavigateToHistory={() => setActiveScreen('history')}
        onImportDxf={() => fileInputRef.current?.click()}
        onAddToCart={handleAddToCart}
        onExportDxf={handleExportDxf}
        onExportPdf={handleExportPdf}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onSaveProject={handleSaveProject}
        onOpenProject={handleOpenProject}
        isExportBlocked={isExportBlocked}
        isRecalculating={isRecalculating}
      />

      {/* Input de arquivo oculto para importacao de DXF */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf,application/dxf,image/vnd.dxf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportDxf(f);
          e.target.value = ''; // permite reimportar o mesmo arquivo
        }}
      />

      {/* Screen 1: Dedicated Template Library Hub (Clean Light Catalog Environment) */}
      {activeScreen === 'library' && (
        <TemplateCatalog
          selectedTemplateId={currentTemplate.id}
          onSelectTemplate={handleSelectTemplate}
        />
      )}

      {/* Screen 2: CAD Workspace & Parametric Configurator (Dark Engineering Studio Environment) */}
      {activeScreen === 'workspace' && (
        <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 flex flex-col gap-6">
          {/* Presets de parametros (item 10) */}
          {!isImported && (
            <div className="flex items-center gap-2 flex-wrap bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xs">
              <span className="text-xs font-semibold text-slate-600">Presets:</span>
              {presets.length === 0 && (
                <span className="text-xs text-slate-400">nenhum salvo para este modelo</span>
              )}
              {presets.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 pl-2 pr-1 py-1 text-xs">
                  <button onClick={() => handleApplyPreset(p.id)} className="font-medium text-slate-700 hover:text-[#FF3000]" title="Aplicar este preset">{p.name}</button>
                  <button onClick={() => handleDeletePreset(p.id)} aria-label={`Excluir preset ${p.name}`} className="w-4 h-4 inline-flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50">×</button>
                </span>
              ))}
              <span className="flex items-center gap-1 ml-auto">
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                  placeholder="Nome do preset"
                  aria-label="Nome do novo preset"
                  className="w-32 px-2 py-1 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-[#FF3000]"
                />
                <button onClick={handleSavePreset} className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition">Salvar preset</button>
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: CAD Viewport with 2D Blank & Interactive 3D Engine (7 cols on lg, sticky on desktop) */}
            <section className="lg:col-span-7 cad-viewport-sticky pr-0.5 flex flex-col gap-4">
              <CadErrorBoundary resetKeys={[effectiveTemplate.id]}>
                <CadViewport
                  geometry={geometry}
                  template={effectiveTemplate}
                  partName={partName}
                  params={effectiveParams}
                  allow3d={!isImported}
                />
              </CadErrorBoundary>
            </section>

            {/* Right Column: Configurador (paramétrico) ou painel da peça importada */}
            <section className="lg:col-span-5 flex flex-col">
              {isImported && importReport ? (
                <ImportedPartPanel
                  geometry={geometry}
                  report={importReport}
                  partName={partName}
                  thicknessMm={importedThickness}
                  onPartNameChange={setPartName}
                  onThicknessChange={setImportedThickness}
                />
              ) : (
                <ConfiguratorPanel
                  template={currentTemplate}
                  params={params}
                  features={features}
                  geometry={geometry}
                  partName={partName}
                  isRecalculating={isRecalculating}
                  onParamChange={handleParamChange}
                  onFeatureToggle={handleFeatureToggle}
                  onFeatureParamChange={handleFeatureParamChange}
                  onPartNameChange={setPartName}
                />
              )}
            </section>
          </div>

          {/* Technical Specifications Panel: Rolls with the page normally */}
          <section className="w-full">
            <TechnicalSpecsPanel
              geometry={geometry}
              template={effectiveTemplate}
              params={effectiveParams}
            />
          </section>

          {/* Quotation & Industrial Cost Engine Panel */}
          <section className="w-full">
            <QuotePanel
              geometry={geometry}
              params={effectiveParams}
              features={isImported ? {} : debouncedFeatures}
              template={effectiveTemplate}
              partName={partName}
              onNavigateToAdmin={() => setActiveScreen('admin')}
            />
          </section>
        </main>
      )}

      {/* Screen 3: Administrative Panel & Cost Foundation */}
      {activeScreen === 'admin' && (
        <AdminPanel
          onBackToLibrary={() => setActiveScreen('library')}
        />
      )}

      {/* Screen 4: Carrinho de Corte (lote) */}
      {activeScreen === 'cart' && (
        <CartView
          items={cartItems}
          onUpdateQty={handleUpdateCartQty}
          onRemove={handleRemoveFromCart}
          onDuplicate={handleDuplicateCartItem}
          onEdit={handleEditCartItem}
          onBack={() => setActiveScreen(importedGeometry || currentTemplate ? 'workspace' : 'library')}
          onNavigateToAdmin={() => setActiveScreen('admin')}
        />
      )}

      {/* Screen 5: Historico de orcamentos */}
      {activeScreen === 'history' && (
        <HistoryView
          onReopen={handleReopenHistory}
          onBack={() => setActiveScreen('library')}
        />
      )}

      {/* Avisos nao bloqueantes (toasts) */}
      <Toaster />
    </div>
  );
}
