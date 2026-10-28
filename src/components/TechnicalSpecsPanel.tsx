import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Code, Check, Copy } from 'lucide-react';
import { GeometryResult, TemplateDefinition } from '../types/cad';
import { formatCleanNumber } from './ConfiguratorPanel';
import { generateDxfR2000, DEFAULT_DXF_OPTIONS } from '../engine/dxfExporter';

interface SpecRowProps {
  label: string;
  tooltip?: string;
  value: React.ReactNode;
  unit?: string;
  isMono?: boolean;
}

const SpecRow: React.FC<SpecRowProps> = ({ label, tooltip, value, unit, isMono = true }) => (
  <div className="flex items-center justify-between py-1.5 text-xs">
    <span
      className="text-slate-600 font-sans cursor-default transition-colors hover:text-slate-900 select-none"
      title={tooltip}
    >
      {label}
    </span>
    <div className="text-right whitespace-nowrap pl-3">
      <span className={`text-slate-900 font-medium ${isMono ? 'font-mono' : 'font-sans'}`}>
        {value}
      </span>
      {unit && (
        <span
          className={`text-slate-400 font-sans font-normal text-[11px] ${
            unit === '°' ? '' : 'ml-1'
          }`}
        >
          {unit}
        </span>
      )}
    </div>
  </div>
);

interface TechnicalSpecsPanelProps {
  geometry: GeometryResult;
  template: TemplateDefinition;
  params: Record<string, number>;
}

export const TechnicalSpecsPanel: React.FC<TechnicalSpecsPanelProps> = ({
  geometry,
  template,
  params,
}) => {
  // Collapsible state: closed by default, resets on template switch (ITEM 1)
  const [isSpecsOpen, setIsSpecsOpen] = useState(false);

  useEffect(() => {
    setIsSpecsOpen(false);
  }, [template.id]);

  const [showDxfPreview, setShowDxfPreview] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const rawDxfSample = useMemo(() => {
    try {
      const fullDxf = generateDxfR2000(geometry, DEFAULT_DXF_OPTIONS);
      const lines = fullDxf.split('\n');
      return (
        lines.slice(0, 45).join('\n') +
        '\n... [DXF R2000 Output Total: ' +
        lines.length +
        ' linhas]'
      );
    } catch {
      return 'Erro ao gerar amostra de código DXF R2000.';
    }
  }, [geometry]);

  const handleCopySummary = () => {
    const thk = params.thickness || 3.0;
    const estWeight = (geometry.metrics.netAreaMm2 * thk * 0.00785) / 1000;
    const grossWeight = (geometry.metrics.grossAreaMm2 * thk * 0.00785) / 1000;
    const nesting = (
      (geometry.metrics.netAreaMm2 / Math.max(1, geometry.metrics.grossAreaMm2)) *
      100
    ).toFixed(1);

    const summary = `=== ESPECIFICAÇÕES TÉCNICAS DE FABRICAÇÃO CNC ===
Modelo / Geometria: ${template.name}
Espessura Nominal: ${formatCleanNumber(thk)} mm
Blank Planificado (LxH): ${formatCleanNumber(geometry.metrics.blankWidthMm)} x ${formatCleanNumber(geometry.metrics.blankHeightMm)} mm
Massa Acabada (Líquida): ${formatCleanNumber(estWeight)} kg (Bruta: ${formatCleanNumber(grossWeight)} kg)
Aproveitamento Chapa: ${nesting}%
Perímetro de Corte Laser: ${formatCleanNumber(geometry.metrics.cutLengthMm)} mm (${geometry.metrics.piercingCount} entradas)
Dobras de Prensa CNC: ${geometry.metrics.bendCount} dobras (Ângulo: ${params.bendAngle || 90}°, Ri: ${params.innerRadius ?? 3.0} mm, K: ${geometry.unfoldingMath?.kFactor ?? params.kFactor ?? 0.44})
Norma de Desdobramento: DIN 6935
Camadas CAD: CUT (Laser - Cor 7), BEND (Dobra - Cor 3)`;

    navigator.clipboard.writeText(summary).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden text-slate-800 transition shadow-xs w-full">
      {/* Collapsible Card Header Button */}
      <button
        type="button"
        onClick={() => setIsSpecsOpen(!isSpecsOpen)}
        className="w-full p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-slate-50/80 transition cursor-pointer"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-heading">
              Especificações Técnicas
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 font-semibold">
              {geometry.metrics.bendCount > 0
                ? `${geometry.metrics.bendCount} ${
                    geometry.metrics.bendCount === 1 ? 'Dobra CNC' : 'Dobras CNC'
                  }`
                : 'Corte a Laser'}
            </span>
          </div>

          {/* Resumo compacto quando fechado */}
          {!isSpecsOpen && (
            <p className="text-[11px] font-mono text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                Blank:{' '}
                <strong className="text-slate-700 font-bold">
                  {formatCleanNumber(geometry.metrics.blankWidthMm)} ×{' '}
                  {formatCleanNumber(geometry.metrics.blankHeightMm)} mm
                </strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Espessura:{' '}
                <strong className="text-slate-700 font-bold">
                  {formatCleanNumber(params.thickness || 3.0)} mm
                </strong>
              </span>
              <span className="text-slate-300">•</span>
              <span>
                Peso Est.:{' '}
                <strong className="text-slate-700 font-bold">
                  {formatCleanNumber(
                    (geometry.metrics.netAreaMm2 * (params.thickness || 3.0) * 0.00785) / 1000
                  )}{' '}
                  kg
                </strong>
              </span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-sans text-slate-500 font-medium hidden sm:inline">
            Modelo:{' '}
            <strong className="text-slate-900 font-heading uppercase tracking-wide">
              {template.name}
            </strong>
          </span>
          <div className="p-1 rounded-lg bg-slate-100 text-slate-600">
            {isSpecsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>

      {isSpecsOpen && (
        <div className="p-4 sm:p-6 pt-0 space-y-6 border-t border-slate-100">
          {/* NÍVEL 1: DESTAQUE — Principais números decisórios (ITEM 3.1 & 3.4) */}
          <div className="pt-3 pb-3 border-b border-slate-100">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 lg:gap-6 items-start">
              {/* 1. Blank Desenvolvido */}
              <div className="min-w-0">
                <span
                  className="text-[11px] font-sans text-slate-500 font-medium block truncate"
                  title="Dimensão do blank desenvolvido planificado"
                >
                  Blank desenvolvido
                </span>
                <div className="mt-1 flex items-baseline flex-wrap">
                  <span className="text-base sm:text-lg lg:text-xl font-mono font-bold text-slate-900 whitespace-nowrap">
                    {formatCleanNumber(geometry.metrics.blankWidthMm)} ×{' '}
                    {formatCleanNumber(geometry.metrics.blankHeightMm)}
                  </span>
                  <span className="text-xs font-sans text-slate-400 font-normal ml-1">mm</span>
                </div>
              </div>

              {/* 2. Espessura (ITEM 3.4: movida para a faixa de destaque) */}
              <div className="min-w-0">
                <span
                  className="text-[11px] font-sans text-slate-500 font-medium block truncate"
                  title="Espessura nominal da chapa metálica"
                >
                  Espessura (e)
                </span>
                <div className="mt-1 flex items-baseline">
                  <span className="text-base sm:text-lg lg:text-xl font-mono font-bold text-slate-900 whitespace-nowrap">
                    {formatCleanNumber(params.thickness || 3.0)}
                  </span>
                  <span className="text-xs font-sans text-slate-400 font-normal ml-1">mm</span>
                </div>
              </div>

              {/* 3. Massa da Peça */}
              <div className="min-w-0">
                <span
                  className="text-[11px] font-sans text-slate-500 font-medium block truncate"
                  title="Massa estimada da peça acabada após furos e recortes"
                >
                  Massa da peça
                </span>
                <div className="mt-1 flex items-baseline">
                  <span className="text-base sm:text-lg lg:text-xl font-mono font-bold text-slate-900 whitespace-nowrap">
                    {formatCleanNumber(
                      (geometry.metrics.netAreaMm2 * (params.thickness || 3.0) * 0.00785) / 1000
                    )}
                  </span>
                  <span className="text-xs font-sans text-slate-400 font-normal ml-1">kg</span>
                </div>
              </div>

              {/* 4. Perímetro de Corte */}
              <div className="min-w-0">
                <span
                  className="text-[11px] font-sans text-slate-500 font-medium block truncate"
                  title="Comprimento total do trajeto de corte a laser"
                >
                  Perímetro de corte
                </span>
                <div className="mt-1 flex items-baseline">
                  <span className="text-base sm:text-lg lg:text-xl font-mono font-bold text-slate-900 whitespace-nowrap">
                    {formatCleanNumber(geometry.metrics.cutLengthMm)}
                  </span>
                  <span className="text-xs font-sans text-slate-400 font-normal ml-1">mm</span>
                </div>
              </div>

              {/* 5. Processo CNC */}
              <div className="min-w-0">
                <span
                  className="text-[11px] font-sans text-slate-500 font-medium block truncate"
                  title="Processo de fabricação e quantidade de linhas de dobra CNC"
                >
                  Processo CNC
                </span>
                <div className="mt-1 flex items-baseline">
                  <span className="text-sm sm:text-base lg:text-lg font-sans font-bold text-slate-900 whitespace-nowrap">
                    {geometry.metrics.bendCount > 0
                      ? `${geometry.metrics.bendCount} ${
                          geometry.metrics.bendCount === 1 ? 'Dobra CNC' : 'Dobras CNC'
                        }`
                      : 'Corte a Laser'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* NÍVEL 2: CORPO — Valores operacionais */}

          {/* Grupo 1: Corte a Laser CNC & Eficiência de Material */}
          <div className="space-y-1">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider font-heading">
                Corte a Laser CNC & Eficiência de Material
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12">
              <div className="divide-y divide-slate-100">
                <SpecRow
                  label="Área bruta"
                  tooltip="Área da Chapa Bruta: dimensão do retângulo envolvente de corte"
                  value={formatCleanNumber(geometry.metrics.grossAreaMm2 / 100, 1)}
                  unit="cm²"
                />
                <SpecRow
                  label="Área líquida"
                  tooltip="Área da Chapa Líquida: área da peça após furações e recortes"
                  value={formatCleanNumber(geometry.metrics.netAreaMm2 / 100, 1)}
                  unit="cm²"
                />
                <SpecRow
                  label="Massa do blank"
                  tooltip="Massa do Blank Bruto: peso total da chapa necessária"
                  value={formatCleanNumber(
                    (geometry.metrics.grossAreaMm2 * (params.thickness || 3.0) * 0.00785) / 1000
                  )}
                  unit="kg"
                />
              </div>

              <div className="divide-y divide-slate-100">
                <SpecRow
                  label="Aproveitamento"
                  tooltip="Taxa de Aproveitamento (Nesting): área líquida sobre área bruta"
                  value={formatCleanNumber(
                    (geometry.metrics.netAreaMm2 / Math.max(1, geometry.metrics.grossAreaMm2)) * 100,
                    1
                  )}
                  unit="% útil"
                />
                <SpecRow
                  label="Entradas de corte"
                  tooltip="Entradas de Laser (Piercings): perfurações iniciais do feixe laser"
                  value={
                    geometry.metrics.piercingCount === 1
                      ? '1 entrada'
                      : `${geometry.metrics.piercingCount} entradas`
                  }
                  isMono={false}
                />
              </div>
            </div>
          </div>

          {/* Grupo 2: Conformação & Dobra CNC */}
          <div className="space-y-1">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider font-heading">
                Conformação & Dobra CNC
              </span>
            </div>

            {geometry.metrics.bendCount > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12">
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Ângulo de dobra"
                    tooltip="Ângulo de Dobra: ângulo programado na prensa dobradeira"
                    value={`${params.bendAngle || 90}°`}
                    isMono={false}
                  />
                  <SpecRow
                    label="Sentido"
                    tooltip="Sentido de Dobra: sentido de conformação na matriz (UP/Superior)"
                    value="UP (Superior)"
                    isMono={false}
                  />
                </div>
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Raio interno"
                    tooltip="Raio Interno (Ri): raio da ferramenta de dobra"
                    value={formatCleanNumber(params.innerRadius ?? 3.0)}
                    unit="mm"
                  />
                  <SpecRow
                    label="Raio externo"
                    tooltip="Raio Externo (Re): raio interno somado à espessura"
                    value={formatCleanNumber(
                      (params.innerRadius ?? 3.0) + (params.thickness || 3.0)
                    )}
                    unit="mm"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12">
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Processamento"
                    tooltip="Processo CNC: corte direto em mesa sem etapas de conformação"
                    value="Peça plana (corte direto)"
                    isMono={false}
                  />
                </div>
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Compensação de dobra"
                    tooltip="Compensação de desdobramento para peças planas"
                    value="0.00"
                    unit="mm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* NÍVEL 3: APOIO — Engenharia de desdobramento e camadas */}

          {/* Grupo 3: Engenharia de Desdobramento (DIN 6935) */}
          {geometry.metrics.bendCount > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider font-sans">
                  Engenharia de desdobramento (DIN 6935)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12">
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Fator K"
                    tooltip="Linha Neutra (Fator K): posição relativa da linha neutra (DIN 6935)"
                    value={formatCleanNumber(
                      geometry.unfoldingMath?.kFactor ?? params.kFactor ?? 0.44,
                      2
                    )}
                  />
                  <SpecRow
                    label="Tolerância de dobra"
                    tooltip="Tolerância de Dobra (BA - Bend Allowance): comprimento do arco na linha neutra"
                    value={
                      geometry.unfoldingMath
                        ? formatCleanNumber(geometry.unfoldingMath.bendAllowanceMm, 2)
                        : '—'
                    }
                    unit="mm"
                  />
                </div>
                <div className="divide-y divide-slate-100">
                  <SpecRow
                    label="Dedução de dobra"
                    tooltip="Dedução de Dobra (BD - Bend Deduction): valor subtraído da soma das abas"
                    value={
                      geometry.unfoldingMath
                        ? formatCleanNumber(geometry.unfoldingMath.bendDeductionMm, 2)
                        : '—'
                    }
                    unit="mm"
                  />
                  <SpecRow
                    label="Recuo externo"
                    tooltip="Recuo Externo (OSB - Outside Setback): recuo do vértice à linha de dobra"
                    value={
                      geometry.unfoldingMath
                        ? formatCleanNumber(geometry.unfoldingMath.setbackMm, 2)
                        : '—'
                    }
                    unit="mm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Grupo 4: Mapeamento de Camadas DXF (ITEM 3.5: rótulos CUT e BEND) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider font-sans">
                Mapeamento de camadas DXF
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 lg:gap-x-12">
              <div className="divide-y divide-slate-100">
                <SpecRow
                  label="CUT"
                  tooltip="Layer CUT: contorno externo e rasgos para corte laser/plasma"
                  value="Cor 7 / LWPOLYLINE"
                  isMono={false}
                />
              </div>
              <div className="divide-y divide-slate-100">
                {geometry.metrics.bendCount > 0 ? (
                  <SpecRow
                    label="BEND"
                    tooltip="Layer BEND: linhas de centro de dobra para prensa dobradeira"
                    value="Cor 3 / LINE"
                    isMono={false}
                  />
                ) : (
                  <SpecRow
                    label="Formato DXF"
                    tooltip="Padrão AutoCAD DXF R2000 em formato texto ASCII"
                    value="AutoCAD R2000 (ASCII)"
                    isMono={false}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Grupo 5: Ações e Inspeção ASCII */}
          <div className="pt-2 space-y-3">
            {/* Inspeção de Código ASCII DXF R2000 */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDxfPreview(!showDxfPreview)}
                className="w-full px-3 py-2 bg-slate-50/70 hover:bg-slate-100/80 flex items-center justify-between text-xs font-mono text-slate-600 hover:text-slate-900 transition cursor-pointer"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Code className="w-3.5 h-3.5 text-slate-500" />
                  Inspecionar Código ASCII DXF R2000
                </span>
                {showDxfPreview ? (
                  <ChevronUp className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                )}
              </button>
              {showDxfPreview && (
                <pre className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] max-h-40 overflow-y-auto leading-relaxed border-t border-slate-200">
                  {rawDxfSample}
                </pre>
              )}
            </div>

            {/* Botão Copiar Especificações de Fabricação */}
            <button
              id="btn-copy-tech-summary"
              type="button"
              onClick={handleCopySummary}
              className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-800 font-mono text-xs font-bold rounded-xl border border-slate-300 flex items-center justify-center gap-2 transition shadow-xs cursor-pointer active:scale-[0.99]"
            >
              {copiedSummary ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-emerald-700 font-semibold">
                    Especificações Copiadas com Sucesso!
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-[#FF3000]" />
                  <span>Copiar Especificações de Fabricação (ERP / Orçamento)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
