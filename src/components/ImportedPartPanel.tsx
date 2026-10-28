// DXFAST :: Painel da peca importada (substitui o configurador no modo importado)
// Mostra o relatorio de importacao (bbox, lacos, furos, corte, unidade, avisos) e
// permite ajustar o nome e a espessura (essencial para o orcamento de corte).
// Proibido o caractere traco-longo em qualquer string.

import React from 'react';
import { FileInput, AlertTriangle, Ruler } from 'lucide-react';
import { GeometryResult } from '../types/cad';
import { ImportReport } from '../import/dxfToGeometry';

interface ImportedPartPanelProps {
  geometry: GeometryResult;
  report: ImportReport;
  partName: string;
  thicknessMm: number;
  onPartNameChange: (name: string) => void;
  onThicknessChange: (mm: number) => void;
}

const UNIT_LABEL: Record<number, string> = {
  0: 'indefinida (assumida mm)', 1: 'polegadas', 2: 'pes', 4: 'milimetros',
  5: 'centimetros', 6: 'metros',
};

export const ImportedPartPanel: React.FC<ImportedPartPanelProps> = ({
  geometry, report, partName, thicknessMm, onPartNameChange, onThicknessChange,
}) => {
  const m = geometry.metrics;
  const row = (label: string, value: string) => (
    <div className="flex justify-between font-mono text-[11px] text-slate-600">
      <span>{label}</span>
      <strong className="text-slate-900">{value}</strong>
    </div>
  );

  return (
    <div className="w-full bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <div className="w-10 h-10 rounded-xl bg-red-50 text-[#FF3000] flex items-center justify-center shrink-0">
          <FileInput className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 font-heading">Peça Importada (DXF)</h2>
          <p className="text-xs text-slate-500">Geometria livre lida do arquivo. Ajuste nome e espessura para orçar.</p>
        </div>
      </div>

      {/* Nome */}
      <div>
        <label className="block text-xs text-slate-700 font-semibold mb-1">Nome da Peça</label>
        <input
          value={partName}
          onChange={(e) => onPartNameChange(e.target.value)}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#FF3000]"
        />
      </div>

      {/* Espessura */}
      <div>
        <label className="text-xs text-slate-700 font-semibold mb-1 flex items-center gap-1.5">
          <Ruler className="w-3.5 h-3.5 text-[#FF3000]" />
          Espessura da Chapa (mm)
        </label>
        <input
          type="number" min={0.5} max={50} step={0.5} value={thicknessMm}
          onChange={(e) => onThicknessChange(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#FF3000]"
        />
        <p className="text-[10px] text-slate-400 mt-1">
          O DXF é 2D (sem espessura). Defina aqui a espessura real para o cálculo de corte.
        </p>
      </div>

      {/* Metricas de importacao */}
      <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5">
        <div className="text-[11px] font-bold text-slate-700 pb-1">Geometria reconhecida</div>
        {row('Dimensões (L x A):', `${m.blankWidthMm.toFixed(1)} x ${m.blankHeightMm.toFixed(1)} mm`)}
        {row('Contornos externos:', `${report.outerCount}`)}
        {row('Furos / recortes:', `${report.holeCount}`)}
        {row('Perfurações (pierce):', `${m.piercingCount}`)}
        {row('Comprimento de corte:', `${m.cutLengthMm.toFixed(0)} mm`)}
        {row('Área líquida:', `${(m.netAreaMm2 / 100).toFixed(1)} cm²`)}
        {report.bendCount > 0 && row('Linhas de dobra:', `${report.bendCount}`)}
        {row('Unidade do arquivo:', UNIT_LABEL[report.insunits] || `código ${report.insunits}`)}
      </div>

      {/* Avisos */}
      {report.warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
          {report.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
