import React, { useState, useMemo, useEffect } from 'react';
import {
  FoldHorizontal,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Settings2,
  CircleDot,
  Sliders,
  Pencil,
  Info,
} from 'lucide-react';
import {
  TemplateDefinition,
  TemplateParamDef,
  FeatureId,
  FeatureState,
  GeometryResult,
} from '../types/cad';
import { calculateParamBounds } from '../engine/paramBounds';

export function formatCleanNumber(val: number, maxDecimals: number = 2): string {
  if (val === undefined || val === null || isNaN(val)) return '0';
  if (Math.abs(val - Math.round(val)) < 1e-6) {
    return Math.round(val).toString();
  }
  return Number(val.toFixed(maxDecimals)).toString();
}

// Campo de texto numerico com validacao de intervalo. Definido no escopo do
// modulo (nao dentro do componente) para que o React nao o remonte a cada
// re-render do painel, o que faria o campo perder o foco e o texto ainda nao
// confirmado enquanto o usuario digita.
const BoundedNumericInput: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (val: number) => void;
}> = ({ value, min, max, unit, onChange }) => {
  const [localStr, setLocalStr] = useState<string>(value.toString());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setLocalStr(value.toString());
  }, [value]);

  const commitValue = () => {
    const parsed = parseFloat(localStr);
    if (isNaN(parsed) || parsed < min || parsed > max) {
      const msg = `Valor fora do intervalo [${min}, ${max}${unit && unit !== 'factor' ? ' ' + unit : ''}]. Ajuste recusado.`;
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 3500);
      setLocalStr(value.toString());
      return;
    }
    setErrorMsg(null);
    onChange(parsed);
  };

  return (
    <div className="relative flex-1 flex flex-col">
      <div className="relative flex-1 flex items-center">
        <input
          type="text"
          inputMode="decimal"
          value={localStr}
          onChange={(e) => {
            setLocalStr(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitValue();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={`w-full px-2.5 py-1.5 sm:py-2 bg-white border ${
            errorMsg ? 'border-red-500 bg-red-50/50' : 'border-slate-300 hover:border-slate-400'
          } rounded-lg text-xs font-mono font-bold text-slate-900 text-right pr-7 focus:outline-none focus:ring-2 focus:ring-[#FF3000]/20 focus:border-[#FF3000] transition`}
        />
        <span className="absolute right-2 text-[10px] font-mono font-normal text-slate-400 pointer-events-none select-none">
          {unit !== 'factor' ? unit : ''}
        </span>
      </div>
      {errorMsg && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 p-1 bg-red-600 text-white text-[9px] font-mono rounded shadow-md">
          {errorMsg}
        </div>
      )}
    </div>
  );
};

interface ConfiguratorPanelProps {
  template: TemplateDefinition;
  params: Record<string, number>;
  features: Record<FeatureId, FeatureState>;
  geometry: GeometryResult;
  partName: string;
  isRecalculating?: boolean;
  onParamChange: (key: string, value: number) => void;
  onFeatureToggle: (featureId: FeatureId, enabled: boolean) => void;
  onFeatureParamChange: (featureId: FeatureId, paramKey: string, value: any) => void;
  onPartNameChange: (name: string) => void;
}

import { FEATURE_METADATA } from './configurator/featureMetadata';

export const ConfiguratorPanel: React.FC<ConfiguratorPanelProps> = ({
  template,
  params,
  features,
  geometry,
  partName,
  isRecalculating = false,
  onParamChange,
  onFeatureToggle,
  onFeatureParamChange,
  onPartNameChange,
}) => {
  // Accordion Sections State: Section 1 starts open, others collapsed.
  const [openSections, setOpenSections] = useState<{
    dimensions: boolean;
    holes: boolean;
    bends: boolean;
  }>({
    dimensions: true,
    holes: false,
    bends: false,
  });

  // Reset accordion state on template switch (Requirement 3: "Ao trocar de template, volta a esse estado")
  useEffect(() => {
    setOpenSections({
      dimensions: true,
      holes: false,
      bends: false,
    });
  }, [template.id]);

  const toggleSection = (section: 'dimensions' | 'holes' | 'bends') => {
    setOpenSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Dynamic bounds calculation for anti-error feedback in UI inputs
  const dynamicParamBounds = useMemo(() => {
    return calculateParamBounds(template, params, features);
  }, [template, params, features]);

  // Adjust parameter with dynamic safety
  const adjustParam = (key: string, delta: number) => {
    const def = template.baseParams[key];
    const current = params[key] ?? def?.default ?? 0;
    const dyn = dynamicParamBounds[key];
    const min = dyn?.min ?? def?.min ?? 0;
    const max = dyn?.max ?? def?.max ?? 10000;
    const nextVal = Math.min(max, Math.max(min, current + delta));
    onParamChange(key, Number(nextVal.toFixed(2)));
  };

  // State for inline part name editing (ITEM 3)
  const [isEditingName, setIsEditingName] = useState(false);

  // States for active info popups (ITEM 8)
  const [activeParamInfo, setActiveParamInfo] = useState<string | null>(null);
  const [activeFeatureInfo, setActiveFeatureInfo] = useState<string | null>(null);

  const activeFeaturesCount = useMemo(() => {
    return Object.values(features).filter((f: any) => Boolean(f?.enabled)).length;
  }, [features]);

  const totalBendsCount = useMemo(() => {
    return geometry.bendLines?.length || 0;
  }, [geometry.bendLines]);

  // Parametros que sao furacao intrinseca (sem feature modular), por template.
  // Vao exibidos na secao "Furacao e recortes", nao em "Dimensoes".
  const HOLE_PARAMS: Record<string, string[]> = {
    gusset_bracket: ['holeDiameter', 'baseHoleCount', 'basePitch', 'baseGauge', 'baseStartOffset', 'uprightHoleCount', 'uprightPitch', 'uprightGauge', 'uprightStartOffset'],
    lifting_lug: ['holeDiameter'],
    rufo_flashing: ['holeDiameter', 'holeCount', 'holePitch', 'holeGauge', 'holeStartOffset'],
    lambril_z: ['holesFixing', 'holeFace', 'holeQty', 'holeDiameter', 'holePitch', 'oblongHoles', 'slotLength'],
    gate_weight_box: ['holesDrain', 'drainDiameter', 'drainQty', 'drainRowSpacing', 'holesFixing', 'fixingFace', 'fixingQty', 'fixingDiameter', 'fixingPitch', 'fixingOblong', 'fixingSlotLength'],
    gate_guide_u: ['holesBase', 'holeQty', 'holeDiameter', 'holePitch', 'oblongHoles', 'slotLength'],
  };
  const isHoleParam = (key: string): boolean => (HOLE_PARAMS[template.id] || []).includes(key);

  // Regras de visibilidade dependente (sub-parametros so aparecem com o toggle pai
  // ligado). Valem nas duas secoes (dimensoes e furacao).
  const isParamVisible = (key: string): boolean => {
    if (template.id === 'gate_guide_u') {
      const isSym = (params.symmetric ?? 1) !== 0;
      if (isSym && (key.endsWith('_left') || key.endsWith('_right'))) return false;
      if (!isSym && (key === 'webB' || key === 'flareC' || key === 'flareAngle')) return false;
      const hasHoles = (params.holesBase ?? 1) !== 0;
      if (!hasHoles && ['holeQty', 'holeDiameter', 'holePitch', 'holeEdgeMargin', 'oblongHoles', 'slotLength'].includes(key)) return false;
      const isOblong = (params.oblongHoles ?? 0) !== 0;
      if (!isOblong && key === 'slotLength') return false;
    } else if (template.id === 'gate_weight_box') {
      const isSquare = (params.squareSection ?? 0) !== 0;
      if (isSquare && key === 'widthB') return false;
      const hasDrain = (params.holesDrain ?? 1) !== 0;
      if (!hasDrain && ['drainDiameter', 'drainQty', 'drainRowSpacing', 'drainEdgeMargin'].includes(key)) return false;
      const hasFixing = (params.holesFixing ?? 0) !== 0;
      if (!hasFixing && ['fixingFace', 'fixingQty', 'fixingDiameter', 'fixingEdgeMargin', 'fixingOblong', 'fixingSlotLength'].includes(key)) return false;
      const isOblong = (params.fixingOblong ?? 0) !== 0;
      if (!isOblong && key === 'fixingSlotLength') return false;
    } else if (template.id === 'lambril_z') {
      const hasFixing = (params.holesFixing ?? 0) !== 0;
      if (!hasFixing && ['holeFace', 'holeQty', 'holeDiameter', 'holePitch', 'holeEdgeMargin', 'oblongHoles', 'slotLength'].includes(key)) return false;
      const isOblong = (params.oblongHoles ?? 0) !== 0;
      if (!isOblong && key === 'slotLength') return false;
    }
    return true;
  };

  const renderParamRow = (key: string, def: TemplateParamDef): React.ReactNode => {
                    const val = params[key] ?? def.default;
                    const dyn = dynamicParamBounds[key];
                    const effectiveMin = dyn?.min ?? def.min;
                    const effectiveMax = dyn?.max ?? def.max;
                    const isToggle = def.step === 1 && def.min === 0 && def.max === 1;

                    if (template.id === 'lambril_z' && key === 'holeFace') {
                      const currentVal = Math.round(val);
                      const options = [
                        { id: 0, label: 'Face A (Superior)' },
                        { id: 1, label: 'Face C (Inferior)' },
                        { id: 2, label: 'Ambas as Faces' },
                      ];
                      return (
                        <div
                          key={key}
                          id="param-container-lambril-holeFace"
                          className="bg-slate-50/70 p-3 rounded-xl space-y-1.5 transition-colors hover:bg-slate-50 col-span-1 sm:col-span-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <label className="text-xs font-medium text-slate-600 font-sans" title={def.label}>
                                {def.label}
                              </label>
                              {def.description && (
                                <button
                                  type="button"
                                  id="btn-info-lambril-holeFace"
                                  onClick={() => setActiveParamInfo((prev) => (prev === key ? null : key))}
                                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition hover:bg-slate-200/60 shrink-0"
                                  title={def.description}
                                  aria-label={`Informações sobre ${def.label}`}
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          {def.description && activeParamInfo === key && (
                            <div className="text-[11px] text-slate-700 bg-white p-2 rounded-md border border-slate-200 leading-relaxed font-sans shadow-xs">
                              {def.description}
                            </div>
                          )}
                          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono pt-1">
                            {options.map((opt) => {
                              const active = currentVal === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  id={`btn-lambril-holeface-${opt.id}`}
                                  type="button"
                                  onClick={() => onParamChange(key, opt.id)}
                                  className={`px-2.5 py-1.5 rounded-lg text-center border font-bold transition truncate ${
                                    active
                                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    if (isToggle) {
                      const isChecked = val !== 0;
                      return (
                        <div
                          key={key}
                          className="bg-slate-50/70 p-3 rounded-xl space-y-1.5 transition-colors hover:bg-slate-50 col-span-1 sm:col-span-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <label className="text-xs font-medium text-slate-600 font-sans" title={def.label}>
                                {def.label}
                              </label>
                              {def.description && (
                                <button
                                  type="button"
                                  onClick={() => setActiveParamInfo((prev) => (prev === key ? null : key))}
                                  className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition hover:bg-slate-200/60 shrink-0"
                                  title={def.description}
                                  aria-label={`Informações sobre ${def.label}`}
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => onParamChange(key, isChecked ? 0 : 1)}
                              className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg transition border ${
                                isChecked
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {isChecked ? 'SIM / ATIVO' : 'NÃO / INATIVO'}
                            </button>
                          </div>
                          {def.description && activeParamInfo === key && (
                            <div className="text-[11px] text-slate-700 bg-white p-2 rounded-md border border-slate-200 leading-relaxed font-sans shadow-xs">
                              {def.description}
                            </div>
                          )}
                        </div>
                      );
                    }

                    const pct = Math.min(
                      100,
                      Math.max(0, ((val - effectiveMin) / Math.max(0.001, effectiveMax - effectiveMin)) * 100)
                    );

                    return (
                      <div
                        key={key}
                        className="bg-slate-50/70 p-3 rounded-xl space-y-1.5 transition-colors hover:bg-slate-50"
                      >
                        {/* Top Row: Full Name of Parameter + Optional Info button */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <label className="text-xs font-medium text-slate-600 font-sans leading-tight truncate cursor-default" title={def.label}>
                              {def.label}
                            </label>
                            {def.description && (
                              <button
                                type="button"
                                onClick={() => setActiveParamInfo((prev) => (prev === key ? null : key))}
                                className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition hover:bg-slate-200/60 shrink-0"
                                title={def.description}
                                aria-label={`Informações sobre ${def.label}`}
                              >
                                <Info className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 font-normal shrink-0">
                            {def.unit !== 'factor' ? def.unit : ''}
                          </span>
                        </div>

                        {/* Inline info description box if toggled */}
                        {def.description && activeParamInfo === key && (
                          <div className="text-[11px] text-slate-700 bg-white p-2 rounded-md border border-slate-200 leading-relaxed font-sans shadow-xs">
                            {def.description}
                          </div>
                        )}

                        {/* Controls Row: Stepper [-], Numeric Input, Stepper [+] */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => adjustParam(key, -def.step)}
                            className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-white hover:bg-slate-100 active:scale-95 text-slate-700 hover:text-slate-900 flex items-center justify-center text-xs font-mono transition border border-slate-300 hover:border-slate-400 shrink-0"
                            title={`-${def.step}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <BoundedNumericInput
                            value={val}
                            min={effectiveMin}
                            max={effectiveMax}
                            step={def.step}
                            unit={def.unit}
                            onChange={(newVal) => onParamChange(key, newVal)}
                          />

                          <button
                            type="button"
                            onClick={() => adjustParam(key, def.step)}
                            className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-white hover:bg-slate-100 active:scale-95 text-slate-700 hover:text-slate-900 flex items-center justify-center text-xs font-mono transition border border-slate-300 hover:border-slate-400 shrink-0"
                            title={`+${def.step}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Factor Description Badge if Applicable */}
                        {(() => {
                          if (template.id === 'gate_weight_box' && key === 'fixingFace') {
                            return (
                              <div className="text-[10px] font-mono font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                {Math.round(val) === 0 ? '0: Face Menor (B)' : '1: Face Maior (A)'}
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Bottom Row: Range Slider */}
                        <div className="space-y-1 pt-1">
                          <input
                            type="range"
                            min={effectiveMin}
                            max={effectiveMax}
                            step={def.step}
                            value={Math.min(effectiveMax, Math.max(effectiveMin, val))}
                            onChange={(e) => onParamChange(key, parseFloat(e.target.value) || 0)}
                            style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
                            className="param-slider"
                            aria-label={`${def.label}${def.unit ? ` (${def.unit})` : ''}`}
                            aria-valuetext={`${formatCleanNumber(val)} ${def.unit || ''}`}
                          />

                          <div className="flex justify-between text-[10px] font-mono text-slate-400 font-normal px-0.5 select-none">
                            <span>Mín: {formatCleanNumber(effectiveMin)}</span>
                            <span>Máx: {formatCleanNumber(effectiveMax)}</span>
                          </div>

                          {dyn?.reason && (
                            <div className="text-[10px] font-mono text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/70 flex items-center gap-1 mt-1">
                              <span className="shrink-0 text-amber-600 font-bold">ℹ️</span>
                              <span className="truncate">{dyn.reason}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
  };

  // Parametros de furacao intrinseca visiveis deste template (para a secao furacao).
  const intrinsicHoleEntries = (Object.entries(template.baseParams) as [string, TemplateParamDef][])
    .filter(([key]) => isHoleParam(key) && isParamVisible(key));

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      {/* Top Header - Reorganized (ITEM 2 & ITEM 3) */}
      <div className="p-3.5 bg-slate-50 border-b border-slate-200">
        <span className="text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider block mb-1">
          Configurador Paramétrico
        </span>
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={partName}
              onChange={(e) => onPartNameChange(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  setIsEditingName(false);
                }
              }}
              placeholder={template.name}
              className="w-full px-2.5 py-1 bg-white border border-[#FF3000] rounded-lg text-sm font-bold text-slate-900 font-heading focus:outline-none focus:ring-1 focus:ring-[#FF3000] transition"
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingName(true)}
            className="w-full text-left group flex items-center justify-between gap-2 py-0.5 rounded transition hover:bg-slate-100/80 px-1 -mx-1"
            title="Clique para editar o nome da peça"
          >
            <h2 className="text-sm font-bold text-slate-900 tracking-tight font-heading truncate group-hover:text-[#FF3000] transition">
              {partName.trim() || template.name}
            </h2>
            <Pencil className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#FF3000] shrink-0 transition opacity-60 group-hover:opacity-100" />
          </button>
        )}
      </div>

      {/* Anti-Colisão & Sanitization Banner */}
      {geometry.warnings.length > 0 && (
        <div className="px-3.5 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
          <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-[11px] leading-tight">
            <div className="font-bold text-amber-900">
              Proteção Geométrica Ativa (Anti-Colisão)
            </div>
            {geometry.warnings.map((w, idx) => (
              <div key={`warn-${idx}-${w.field || 'gen'}`} className="text-amber-800">
                • {w.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Accordion Container with exactly 3 sections in order */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5">
        
        {/* ======================================================== */}
        {/* SEÇÃO 1: MEDIDAS DA PEÇA (Inicia aberta) */}
        {/* ======================================================== */}
        <div className="border border-slate-200 rounded-xl overflow-hidden transition">
          <button
            type="button"
            onClick={() => toggleSection('dimensions')}
            className={`w-full p-3.5 flex items-center justify-between text-left transition ${
              openSections.dimensions
                ? 'bg-slate-50 border-b border-slate-200'
                : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700">
                <Settings2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide font-heading">
                  Medidas da peça
                </h3>
                <p className="text-[11px] text-slate-500 font-sans">
                  Dimensões principais, espessura e parâmetros base
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400 font-medium">
                {Object.keys(template.baseParams).length} {Object.keys(template.baseParams).length === 1 ? 'parâmetro' : 'parâmetros'}
              </span>
              {openSections.dimensions ? (
                <ChevronUp className="w-4 h-4 text-slate-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-600" />
              )}
            </div>
          </button>

          {openSections.dimensions && (
            <div className="p-3.5 space-y-3.5 bg-white">
              <div className="text-[11px] font-mono font-semibold uppercase text-slate-500 tracking-wider flex items-center justify-between">
                <span>Dimensões Principais da Peça</span>
                <span className="text-slate-400 font-normal">Escala 1:1 mm</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                {(Object.entries(template.baseParams) as [string, TemplateParamDef][])
                  .filter(([key]) => isParamVisible(key) && !isHoleParam(key))
                  .map(([key, def]) => renderParamRow(key, def))}
              </div>

              {/* Box de Informações Práticas de Aplicação do Portão */}
              {template.id === 'gate_guide_u' && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                    <span>📐 Dimensões Funcionais de Montagem (Canal & Funil)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[9px]">LARGURA LIVRE INT.</span>
                      <strong className="text-slate-900">{formatCleanNumber((params.baseA ?? 80) - 2 * (params.thickness ?? 3.0))} mm</strong>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[9px]">ABERTURA DA BOCA (FUNIL)</span>
                      <strong className="text-slate-900">
                        {formatCleanNumber((params.baseA ?? 80) + 2 * (params.flareC ?? 50) * Math.sin(((params.flareAngle ?? 45) * Math.PI) / 180))} mm
                      </strong>
                    </div>
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[9px]">ALTURA TOTAL MONTADA</span>
                      <strong className="text-slate-900">
                        {formatCleanNumber((params.webB ?? 80) + (params.flareC ?? 50) * Math.cos(((params.flareAngle ?? 45) * Math.PI) / 180))} mm
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Box de Memória Técnica & Capacidade de Lastro da Caixa de Peso */}
              {template.id === 'gate_weight_box' && (() => {
                const hA = params.heightA ?? 150;
                const isSq = (params.squareSection ?? 0) !== 0;
                const wB = isSq ? hA : (params.widthB ?? 100);
                const thk = params.thickness ?? 1.5;
                const len = params.length ?? 2000;
                const intA = Math.max(0, hA - 2 * thk);
                const intB = Math.max(0, wB - 2 * thk);
                const intAreaCm2 = (intA * intB) / 100;
                const intVolLiters = (intA * intB * len) / 1000000;
                const steelMassKg = (geometry.metrics.grossAreaMm2 * thk * 7.85) / 1000000;
                const concreteKg = intVolLiters * 2.4;
                const sandKg = intVolLiters * 1.6;
                const scrapKg = intVolLiters * 7.8;

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                        📦 Memória Técnica & Capacidade de Lastro (Contrapeso)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">SEÇÃO INTERNA</span>
                        <strong className="text-slate-900">{formatCleanNumber(intA)} × {formatCleanNumber(intB)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">({formatCleanNumber(intAreaCm2)} cm²)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">VOLUME ÚTIL</span>
                        <strong className="text-slate-900">{formatCleanNumber(intVolLiters)} Litros</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">({formatCleanNumber(intVolLiters / 1000, 3)} m³)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">MASSA DO PERFIL</span>
                        <strong className="text-slate-900">{formatCleanNumber(steelMassKg)} kg</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">(Chapa #{formatCleanNumber(thk)}mm)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">LARGURA DO BLANK</span>
                        <strong className="text-slate-900">{formatCleanNumber(geometry.metrics.blankWidthMm)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">(Lplan)</span>
                      </div>
                    </div>

                    {/* Ballast material estimations */}
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                      <div className="text-[10px] font-mono font-semibold text-slate-600 uppercase tracking-wider">
                        Estimativa de Lastro Total (Material + Chapa):
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                        <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
                          <span className="text-slate-500 block text-[9px]">CONCRETO (2.4 kg/L)</span>
                          <strong className="text-slate-900">{formatCleanNumber(concreteKg + steelMassKg)} kg</strong>
                          <span className="text-[9px] text-slate-400 block">({formatCleanNumber(concreteKg)} kg lastro)</span>
                        </div>
                        <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
                          <span className="text-slate-500 block text-[9px]">AREIA SECA (1.6 kg/L)</span>
                          <strong className="text-slate-900">{formatCleanNumber(sandKg + steelMassKg)} kg</strong>
                          <span className="text-[9px] text-slate-400 block">({formatCleanNumber(sandKg)} kg lastro)</span>
                        </div>
                        <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
                          <span className="text-slate-500 block text-[9px]">CHUMBO/FERRO (7.8 kg/L)</span>
                          <strong className="text-slate-900">{formatCleanNumber(scrapKg + steelMassKg)} kg</strong>
                          <span className="text-[9px] text-slate-400 block">({formatCleanNumber(scrapKg)} kg lastro)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Box de Informações de Engenharia do Polígono Regular */}
              {template.id === 'polygon_regular' && (() => {
                const N = Math.max(3, Math.min(24, Math.round(params.sidesCount || 6)));
                const OD = params.outerDiameter || 180;
                const R = OD / 2;
                const rIn = R * Math.cos(Math.PI / N);
                const acrossFlats = 2 * rIn;
                const sideLen = 2 * R * Math.sin(Math.PI / N);
                const interiorAngleDeg = ((N - 2) * 180) / N;
                const polygonNames: Record<number, string> = {
                  3: 'Triângulo Equilátero',
                  4: 'Quadrado Regular',
                  5: 'Pentágono Regular',
                  6: 'Hexágono (Sextavado)',
                  7: 'Heptágono Regular',
                  8: 'Octógono Regular',
                  9: 'Eneágono Regular',
                  10: 'Decágono Regular',
                  12: 'Dodecágono Regular',
                };
                const polyName = polygonNames[N] || `Polígono de ${N} Lados`;

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                        📐 Propriedades Geométricas ({polyName})
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-slate-200 text-slate-800 rounded">
                        N = {N}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">ENTRE FACES (CHAVE)</span>
                        <strong className="text-slate-900">{formatCleanNumber(acrossFlats)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Apótema: {formatCleanNumber(rIn)} mm</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">LADO DA ARESTA</span>
                        <strong className="text-slate-900">{formatCleanNumber(sideLen)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">({N}× arestas)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">ÂNGULO INTERNO</span>
                        <strong className="text-slate-900">{formatCleanNumber(interiorAngleDeg)}°</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Giro: {formatCleanNumber(360 / N)}°</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">DIÂMETRO CIRCUNSCRITO</span>
                        <strong className="text-slate-900">Ø{formatCleanNumber(OD)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Ponta a ponta</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Box de Informações de Engenharia da Flange Oval */}
              {template.id === 'oval_flange' && (() => {
                const CC = params.centerDistance || 130;
                const R = params.endRadius || 35;
                const totalL = CC + 2 * R;
                const totalW = 2 * R;
                const boltD = params.boltHoleDia || 14;
                const isCenterHole = features.centerHole?.enabled ?? false;
                const centerHoleDia = isCenterHole ? Number(features.centerHole?.params?.diameter ?? 50) : 0;

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                        📐 Propriedades da Flange Oval (Bi-Furos)
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-slate-200 text-slate-800 rounded">
                        {isCenterHole ? `Passante Ø${formatCleanNumber(centerHoleDia)}mm` : 'Flange Cega'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">COMPRIMENTO (L)</span>
                        <strong className="text-slate-900">{formatCleanNumber(totalL)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">C-C + 2×R</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">LARGURA (W)</span>
                        <strong className="text-slate-900">{formatCleanNumber(totalW)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Raio: R{formatCleanNumber(R)} mm</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">CENTRO A CENTRO</span>
                        <strong className="text-slate-900">{formatCleanNumber(CC)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">2× Furos Ø{formatCleanNumber(boltD)} mm</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">FURO CENTRAL</span>
                        {isCenterHole && centerHoleDia > 0 ? (
                          <>
                            <strong className="text-slate-900">Ø{formatCleanNumber(centerHoleDia)} mm</strong>
                            <span className="text-[9px] text-slate-500 block mt-0.5">Passante ativo</span>
                          </>
                        ) : (
                          <>
                            <strong className="text-slate-400">Nenhum</strong>
                            <span className="text-[9px] text-slate-400 block mt-0.5">Superfície contínua</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Box de Informações de Engenharia do Olhal de Içamento */}
              {template.id === 'lifting_lug' && (() => {
                const H = params.totalHeight || 180;
                const R = params.topRadius || 50;
                const alphaDeg = params.baseAngle ?? 15;
                const alphaRad = (alphaDeg * Math.PI) / 180;
                const holeD = params.holeDiameter || 45;
                const xTR = R * Math.cos(alphaRad);
                const deltaY = (H - R) + R * Math.sin(alphaRad);
                const xBase = xTR + deltaY * Math.tan(alphaRad);
                const baseWidth = 2 * xBase;
                const wallThk = R - holeD / 2;
                const hCenter = H - R;

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                        📐 Propriedades do Olhal de Içamento
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-slate-200 text-slate-800 rounded">
                        Tangência Contínua (G¹)
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">LARGURA DA BASE</span>
                        <strong className="text-slate-900">{formatCleanNumber(baseWidth)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Calculada (2×X)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">ABERTURA LATERAL</span>
                        <strong className="text-slate-900">{formatCleanNumber(alphaDeg)}°</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">{alphaDeg === 0 ? 'Abas Retas' : 'Corpo Trapezoidal'}</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">PAREDE DO OLHAL</span>
                        <strong className="text-slate-900">{formatCleanNumber(wallThk)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Raio R{formatCleanNumber(R)} - Furo Ø{formatCleanNumber(holeD)}</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">ALTURA AO CENTRO</span>
                        <strong className="text-slate-900">{formatCleanNumber(hCenter)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Base à manilha</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Box de Informações de Engenharia da Chapa Retangular */}
              {template.id === 'rect_plate' && (() => {
                const W = params.width || 200;
                const H = params.height || 150;
                const thk = params.thickness || 3.0;
                const areaCm2 = geometry.metrics.grossAreaMm2 / 100;
                const netAreaCm2 = geometry.metrics.netAreaMm2 / 100;
                const perimeterM = geometry.metrics.cutLengthMm / 1000;
                const massKg = (geometry.metrics.grossAreaMm2 * thk * 7.85) / 1000000;
                const netMassKg = (geometry.metrics.netAreaMm2 * thk * 7.85) / 1000000;

                return (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-heading flex items-center gap-1.5">
                        📐 Propriedades da Chapa Paramétrica
                      </span>
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 bg-slate-200 text-slate-800 rounded">
                        #{formatCleanNumber(thk)}mm ({geometry.metrics.piercingCount} {geometry.metrics.piercingCount === 1 ? 'Recorte' : 'Recortes'})
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">DIMENSÕES</span>
                        <strong className="text-slate-900">{formatCleanNumber(W, 0)} × {formatCleanNumber(H, 0)} mm</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">({formatCleanNumber(areaCm2)} cm²)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">MASSA LÍQUIDA</span>
                        <strong className="text-slate-900">{formatCleanNumber(netMassKg)} kg</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">(Bruto: {formatCleanNumber(massKg)} kg)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">PERÍMETRO CORTE</span>
                        <strong className="text-slate-900">{formatCleanNumber(perimeterM)} m</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">(Laser/Plasma)</span>
                      </div>
                      <div className="bg-white p-2 rounded-lg border border-slate-200">
                        <span className="text-slate-500 block text-[9px]">PERFURAÇÕES</span>
                        <strong className="text-slate-900">{geometry.metrics.piercingCount} {geometry.metrics.piercingCount === 1 ? 'Piercing' : 'Piercings'}</strong>
                        <span className="text-[9px] text-slate-400 block mt-0.5">Internos ativos</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* SEÇÃO 2: FURAÇÃO E RECORTES (Inicia recolhida) */}
        {/* ======================================================== */}
        <div className="border border-slate-200 rounded-xl overflow-hidden transition">
          <button
            type="button"
            onClick={() => toggleSection('holes')}
            className={`w-full p-3.5 flex items-center justify-between text-left transition ${
              openSections.holes
                ? 'bg-slate-50 border-b border-slate-200'
                : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700">
                <CircleDot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide font-heading">
                  Furação e recortes
                </h3>
                <p className="text-[11px] text-slate-500 font-sans">
                  Furos, rasgos, grades, círculo de furação, raios e chanfros
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                activeFeaturesCount > 0
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-400 bg-slate-100'
              }`}>
                {activeFeaturesCount} {activeFeaturesCount === 1 ? 'ativo' : 'ativos'}
              </span>
              {openSections.holes ? (
                <ChevronUp className="w-4 h-4 text-slate-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-600" />
              )}
            </div>
          </button>

          {openSections.holes && (
            <div className="p-3.5 space-y-3 bg-white">
              {template.compatibleFeatures.length > 0 ? (
                <div className="space-y-2.5">
                  {template.compatibleFeatures.map((featId) => {
                    const feat = FEATURE_METADATA[featId];
                    if (!feat) return null;
                    const state = features[featId] || { enabled: false, params: {} };
                    const isSlotted = featId === 'slottedHoles';
                    const isFaceHoles = featId === 'faceHoles';

                    // Dynamic face options for bent profile hole placement
                    const faceOptions = (() => {
                      if (template.id === 'profile_u') {
                        return [
                          { id: 'alma', label: 'Alma B (Base)' },
                          { id: 'abaA', label: 'Aba A (Esq)' },
                          { id: 'abaC', label: 'Aba C (Dir)' },
                        ];
                      }
                      if (template.id === 'profile_l') {
                        return [
                          { id: 'abaA', label: 'Aba A (Vert)' },
                          { id: 'abaB', label: 'Aba B (Base)' },
                        ];
                      }
                      if (template.id === 'profile_z') {
                        return [
                          { id: 'alma', label: 'Alma B (Centro)' },
                          { id: 'abaA', label: 'Aba Sup A' },
                          { id: 'abaC', label: 'Aba Inf C' },
                        ];
                      }
                      if (template.id === 'profile_hat') {
                        return [
                          { id: 'alma', label: 'Alma C (Topo)' },
                          { id: 'abaA', label: 'Aba A1 (Esq)' },
                          { id: 'abaB', label: 'Aba B1' },
                          { id: 'abaB2', label: 'Aba B2' },
                          { id: 'abaC', label: 'Aba A2 (Dir)' },
                        ];
                      }
                      return [
                        { id: 'alma', label: 'Face Central / Alma' },
                        { id: 'abaA', label: 'Aba A' },
                        { id: 'abaC', label: 'Aba C' },
                      ];
                    })();

                    return (
                      <div
                        key={featId}
                        className={`p-3 rounded-xl border transition-all ${
                          state.enabled
                            ? 'bg-slate-50/90 border-slate-300'
                            : 'bg-slate-50/40 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                            <input
                              type="checkbox"
                              checked={state.enabled}
                              onChange={(e) => onFeatureToggle(featId, e.target.checked)}
                              className="w-4 h-4 rounded text-slate-900 focus:ring-slate-900 accent-slate-900 border-slate-300"
                            />
                            <span className="text-xs font-semibold text-slate-800 font-heading truncate">
                              {feat.name}
                            </span>
                          </label>
                          {feat.description ? (
                            <button
                              type="button"
                              onClick={() => setActiveFeatureInfo((prev) => (prev === featId ? null : featId))}
                              className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition hover:bg-slate-200/60 shrink-0"
                              title={feat.description}
                              aria-label={`Informações sobre ${feat.name}`}
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>

                        {/* Inline info description box for feature if toggled */}
                        {feat.description && activeFeatureInfo === featId && (
                          <div className="mt-2 text-[11px] text-slate-700 bg-slate-100/90 p-2 rounded-md border border-slate-200 leading-relaxed font-sans">
                            {feat.description}
                          </div>
                        )}

                        {/* Feature Parameters when enabled */}
                        {state.enabled && (
                          <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-3">
                            {/* Special Controls for Slotted Holes */}
                            {isSlotted && (
                              <div className="space-y-2.5 pb-2 border-b border-slate-200">
                                {/* Pattern Selection */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono font-semibold text-slate-600 uppercase">
                                    Disposição dos Rasgos:
                                  </span>
                                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-[11px] font-mono">
                                    {[
                                      { id: 'corners', label: '4 Cantos' },
                                      { id: 'parallel_2', label: '2 Paralelos' },
                                      { id: 'linear_x', label: 'Linha X' },
                                      { id: 'linear_y', label: 'Linha Y' },
                                      { id: 'grid', label: 'Matriz' },
                                    ].map((pat) => {
                                      const active = (state.params?.pattern || 'corners') === pat.id;
                                      return (
                                        <button
                                          key={pat.id}
                                          type="button"
                                          onClick={() => onFeatureParamChange('slottedHoles', 'pattern', pat.id)}
                                          className={`px-2 py-1 rounded text-center border font-bold transition ${
                                            active
                                              ? 'bg-slate-900 text-white border-slate-900'
                                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                          }`}
                                        >
                                          {pat.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Orientation Selection */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono font-semibold text-slate-600 uppercase">
                                    Orientação do Rasgo:
                                  </span>
                                  <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                                    {[
                                      { id: 'horizontal', label: 'Horizontal (↔ Eixo X)' },
                                      { id: 'vertical', label: 'Vertical (↕ Eixo Y)' },
                                    ].map((ori) => {
                                      const active = (state.params?.orientation || 'horizontal') === ori.id;
                                      return (
                                        <button
                                          key={ori.id}
                                          type="button"
                                          onClick={() => onFeatureParamChange('slottedHoles', 'orientation', ori.id)}
                                          className={`px-2 py-1 rounded text-center border font-bold transition ${
                                            active
                                              ? 'bg-slate-900 text-white border-slate-900'
                                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                          }`}
                                        >
                                          {ori.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Travel Stroke Info */}
                                {(() => {
                                  const L = Number(state.params?.length ?? 40);
                                  const W = Number(state.params?.width ?? 14);
                                  const stroke = Math.max(0, L - W);
                                  return (
                                    <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded-md text-[10px] font-mono text-slate-700">
                                      <span>Curso Útil de Ajuste (Stroke): <strong>{stroke.toFixed(1)} mm</strong></span>
                                      <span>Raio dos Topos: <strong>R{(W / 2).toFixed(1)} mm</strong></span>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Special Controls for Face Holes in Bent Profiles */}
                            {isFaceHoles && (
                              <div className="space-y-2.5 pb-2 border-b border-slate-200">
                                {/* Face Selection */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono font-semibold text-slate-600 uppercase">
                                    Face / Aba de Aplicação:
                                  </span>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[11px] font-mono">
                                    {faceOptions.map((fOpt) => {
                                      const active = (state.params?.faceSelect || 'alma') === fOpt.id;
                                      return (
                                        <button
                                          key={fOpt.id}
                                          type="button"
                                          onClick={() => onFeatureParamChange('faceHoles', 'faceSelect', fOpt.id)}
                                          className={`px-2 py-1 rounded text-center border font-bold transition truncate ${
                                            active
                                              ? 'bg-slate-900 text-white border-slate-900'
                                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                          }`}
                                        >
                                          {fOpt.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Hole Type Selection */}
                                <div className="space-y-1">
                                  <span className="text-[10px] font-mono font-semibold text-slate-600 uppercase">
                                    Geometria da Furação:
                                  </span>
                                  <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                                    {[
                                      { id: 'circle', label: 'Furo Cilíndrico (Ø)' },
                                      { id: 'slot', label: 'Rasgo Oblongo (Slot)' },
                                    ].map((ht) => {
                                      const active = (state.params?.holeType || 'circle') === ht.id;
                                      return (
                                        <button
                                          key={ht.id}
                                          type="button"
                                          onClick={() => onFeatureParamChange('faceHoles', 'holeType', ht.id)}
                                          className={`px-2 py-1 rounded text-center border font-bold transition ${
                                            active
                                              ? 'bg-slate-900 text-white border-slate-900'
                                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                          }`}
                                        >
                                          {ht.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Standard parameter grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {feat.params.map((fParam) => {
                                if (isFaceHoles && fParam.key === 'slotLength' && (state.params?.holeType || 'circle') !== 'slot') {
                                  return null;
                                }
                                const fVal = state.params?.[fParam.key] ?? fParam.default;
                                const fDynKey = `${featId}.${fParam.key}`;
                                const dynBound = dynamicParamBounds[fDynKey] || dynamicParamBounds[fParam.key];
                                const effectiveMin = dynBound?.min ?? fParam.min;
                                const effectiveMax = dynBound?.max ?? fParam.max;

                                return (
                                  <div key={fParam.key} className="space-y-1">
                                    <div className="flex justify-between text-[11px]">
                                      <span className="text-slate-600 font-medium">{fParam.label}:</span>
                                      <span className="font-mono text-slate-900 font-medium">{fVal} {fParam.unit}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        aria-label={`Diminuir ${fParam.label}`}
                                        onClick={() =>
                                          onFeatureParamChange(
                                            featId,
                                            fParam.key,
                                            Math.max(effectiveMin, Number((fVal - fParam.step).toFixed(1)))
                                          )
                                        }
                                        className="w-7 h-7 rounded bg-white hover:bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200 transition flex items-center justify-center font-bold"
                                      >
                                        -
                                      </button>
                                      <BoundedNumericInput
                                        value={fVal}
                                        min={effectiveMin}
                                        max={effectiveMax}
                                        step={fParam.step}
                                        unit={fParam.unit}
                                        onChange={(newVal) => onFeatureParamChange(featId, fParam.key, newVal)}
                                      />
                                      <button
                                        type="button"
                                        aria-label={`Aumentar ${fParam.label}`}
                                        onClick={() =>
                                          onFeatureParamChange(
                                            featId,
                                            fParam.key,
                                            Math.min(effectiveMax, Number((fVal + fParam.step).toFixed(1)))
                                          )
                                        }
                                        className="w-7 h-7 rounded bg-white hover:bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200 transition flex items-center justify-center font-bold"
                                      >
                                        +
                                      </button>
                                    </div>
                                    {dynBound?.reason && (
                                      <div className="text-[10px] font-mono text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/70 flex items-center gap-1 mt-0.5">
                                        <span className="shrink-0 text-amber-600 font-bold">ℹ️</span>
                                        <span className="truncate">{dynBound.reason}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : intrinsicHoleEntries.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                  {intrinsicHoleEntries.map(([key, def]) => renderParamRow(key, def))}
                </div>
              ) : (
                <div className="p-3 text-xs text-slate-500 bg-slate-50 rounded-lg text-center font-mono">
                  Nenhuma furação modular aplicável a este modelo.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* SEÇÃO 3: DOBRA (Inicia recolhida) */}
        {/* ======================================================== */}
        <div className="border border-slate-200 rounded-xl overflow-hidden transition">
          <button
            type="button"
            onClick={() => toggleSection('bends')}
            className={`w-full p-3.5 flex items-center justify-between text-left transition ${
              openSections.bends
                ? 'bg-slate-50 border-b border-slate-200'
                : 'bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700">
                <FoldHorizontal className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide font-heading">
                  Dobra
                </h3>
                <p className="text-[11px] text-slate-500 font-sans">
                  Ângulo, raio interno, fator K e dobras manuais
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                totalBendsCount > 0
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-400 bg-slate-100'
              }`}>
                {totalBendsCount} {totalBendsCount === 1 ? 'dobra' : 'dobras'}
              </span>
              {openSections.bends ? (
                <ChevronUp className="w-4 h-4 text-slate-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-600" />
              )}
            </div>
          </button>

          {openSections.bends && (
            <div className="p-3.5 space-y-4 bg-white">
              {/* Global Bend Parameters Card (Ri, Re, K-Factor, Angle) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-1.5 font-heading">
                    <Sliders className="w-3.5 h-3.5" />
                    Parâmetros de Dobra CNC
                  </span>
                </div>

                {/* Internal Radius (Ri) Control */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700">
                      Raio Interno de Dobra (Ri):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-bold text-slate-900">
                        Ri = {params.innerRadius ?? 3.0} mm
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        (Re = {((params.innerRadius ?? 3.0) + (params.thickness || 3.0)).toFixed(1)} mm)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const cur = params.innerRadius ?? 3.0;
                        onParamChange('innerRadius', Math.max(0.5, Number((cur - 0.5).toFixed(1))));
                      }}
                      className="w-8 h-7 rounded bg-white hover:bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200 transition"
                      title="-0.5 mm"
                    >
                      -0.5
                    </button>
                    <input
                      type="number"
                      min={0.5}
                      max={30}
                      step={0.5}
                      value={params.innerRadius ?? 3.0}
                      onChange={(e) => onParamChange('innerRadius', Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                      className="flex-1 px-2 py-1.5 bg-white border border-slate-300 hover:border-slate-400 focus:border-[#FF3000] focus:ring-2 focus:ring-[#FF3000]/20 rounded-lg text-xs font-mono text-slate-900 text-center font-bold focus:outline-none transition"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cur = params.innerRadius ?? 3.0;
                        onParamChange('innerRadius', Math.min(30, Number((cur + 0.5).toFixed(1))));
                      }}
                      className="w-8 h-8 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-mono border border-slate-300 hover:border-slate-400 transition flex items-center justify-center font-bold"
                      title="+0.5 mm"
                    >
                      +0.5
                    </button>
                  </div>

                  <div className="space-y-1 pt-1">
                    <input
                      type="range"
                      min={0.5}
                      max={25}
                      step={0.5}
                      value={params.innerRadius ?? 3.0}
                      onChange={(e) => onParamChange('innerRadius', parseFloat(e.target.value) || 0.5)}
                      style={{
                        '--slider-pct': `${Math.min(100, Math.max(0, (((params.innerRadius ?? 3.0) - 0.5) / 24.5) * 100))}%`,
                      } as React.CSSProperties}
                      className="param-slider"
                      aria-label="Raio interno de dobra (mm)"
                      aria-valuetext={`${params.innerRadius ?? 3.0} mm`}
                    />

                    <div className="flex justify-between text-[10px] font-mono text-slate-400 font-normal px-0.5 select-none">
                      <span>Mín: 0.5</span>
                      <span>Máx: 25.0</span>
                    </div>
                  </div>

                  {/* Quick Punch Radius Standard Buttons */}
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    <span className="text-[10px] font-mono text-slate-400 mr-1 select-none">Raios Usuais:</span>
                    {[1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0].map((rVal) => (
                      <button
                        key={rVal}
                        type="button"
                        onClick={() => onParamChange('innerRadius', rVal)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                          (params.innerRadius ?? 3.0) === rVal
                            ? 'bg-slate-900 text-white font-bold'
                            : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                        }`}
                      >
                        R{rVal}
                      </button>
                    ))}
                  </div>
                </div>

                {/* K-Factor and Bend Angle row */}
                <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-200 text-xs">
                  <div>
                    <label className="text-slate-600 block mb-1 text-[11px] font-medium font-sans">Fator K (Linha Neutra):</label>
                    <input
                      type="number"
                      min={0.2}
                      max={0.8}
                      step={0.01}
                      value={params.kFactor ?? 0.44}
                      onChange={(e) => onParamChange('kFactor', parseFloat(e.target.value) || 0.44)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 hover:border-slate-400 focus:border-[#FF3000] focus:ring-2 focus:ring-[#FF3000]/20 rounded-lg text-slate-900 font-mono text-xs font-bold focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1 text-[11px] font-medium font-sans">Ângulo de Dobra (°):</label>
                    <input
                      type="number"
                      min={30}
                      max={150}
                      step={1}
                      value={params.bendAngle ?? 90}
                      onChange={(e) => onParamChange('bendAngle', parseFloat(e.target.value) || 90)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 hover:border-slate-400 focus:border-[#FF3000] focus:ring-2 focus:ring-[#FF3000]/20 rounded-lg text-slate-900 font-mono text-xs font-bold focus:outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* Native Profile Bends List */}
              {geometry.bendLines && geometry.bendLines.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-semibold uppercase text-slate-500 tracking-wider">
                    Dobras Nativas do Perfil ({geometry.bendLines.length})
                  </div>
                  <div className="space-y-2">
                    {geometry.bendLines.map((bend, idx) => (
                      <div
                        key={bend.id || idx}
                        className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs font-mono"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-slate-900" />
                            Dobra {idx + 1}: {bend.label}
                          </span>
                          <span className="px-2 py-0.5 bg-slate-200 text-slate-800 border border-slate-300 rounded text-[10px] font-bold">
                            {bend.direction} {bend.angleDeg || 90}°
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-700">
                          <div>
                            <span className="text-slate-500">Posição X:</span>{' '}
                            <span className="font-bold text-slate-900">{bend.positionX.toFixed(1)} mm</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Raio Int. (Ri):</span>{' '}
                            <span className="font-bold text-slate-900">{bend.radiusMm} mm</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Fator K:</span>{' '}
                            <span className="font-bold text-slate-900">{bend.kFactor}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
