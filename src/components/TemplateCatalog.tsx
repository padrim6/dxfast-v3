import React, { useState, useMemo } from 'react';
import {
  Search,
  FoldHorizontal,
  Square,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { TemplateDefinition, TemplateCategory } from '../types/cad';
import { TEMPLATES } from '../data/templates';
import { generateGeometry } from '../engine/geometryEngine';
import { polylineToSvgPath } from '../utils/svgPathBuilder';

interface TemplateCatalogProps {
  selectedTemplateId: string;
  onSelectTemplate: (template: TemplateDefinition) => void;
}

// Ordem de exibicao dentro de cada grupo (do mais comum/simples ao mais especial).
// Os perfis dobrados ficam juntos (incluindo o rufo) e as chapas planas juntas.
const BENT_ORDER = [
  'profile_u', 'profile_l', 'profile_z', 'profile_hat',
  'lambril_z', 'rufo_flashing', 'gate_guide_u', 'gate_weight_box',
];
const FLAT_ORDER = [
  'rect_plate', 'base_plate', 'trapezoid_plate', 'polygon_regular', 'star_polygon',
  'circle_flange', 'oval_flange', 'cylinder_development', 'lifting_lug', 'gusset_bracket',
];

function orderBy(list: TemplateDefinition[], order: string[]): TemplateDefinition[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

const FEATURE_LABEL: Record<string, string> = {
  fillet: 'Cantos R', chamfer: 'Chanfros', cornerHoles: '4 Furos Cantos',
  centerHole: 'Furo Central', boltCircle: 'BCD Flange', gridHoles: 'Matriz Grelha',
  keyway: 'Chaveta DIN', faceHoles: 'Furação Abas', slottedHoles: 'Rasgos Oblongos',
};

export const TemplateCatalog: React.FC<TemplateCatalogProps> = ({
  selectedTemplateId,
  onSelectTemplate,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | 'all'>('all');

  const match = (tmpl: TemplateDefinition) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      tmpl.name.toLowerCase().includes(q) ||
      tmpl.description.toLowerCase().includes(q) ||
      tmpl.id.toLowerCase().includes(q)
    );
  };

  const bent = useMemo(
    () => orderBy(TEMPLATES.filter((t) => t.category === 'bent_profile' && match(t)), BENT_ORDER),
    [searchQuery]
  );
  const flat = useMemo(
    () => orderBy(TEMPLATES.filter((t) => t.category === 'flat_sheet' && match(t)), FLAT_ORDER),
    [searchQuery]
  );

  const bentTotal = TEMPLATES.filter((t) => t.category === 'bent_profile').length;
  const flatTotal = TEMPLATES.filter((t) => t.category === 'flat_sheet').length;

  const showBent = (selectedCategory === 'all' || selectedCategory === 'bent_profile') && bent.length > 0;
  const showFlat = (selectedCategory === 'all' || selectedCategory === 'flat_sheet') && flat.length > 0;
  const nothing = bent.length === 0 && flat.length === 0;

  const renderCard = (template: TemplateDefinition) => {
    const isSelected = template.id === selectedTemplateId;
    const sampleGeom = generateGeometry(template, template.defaultParams, template.defaultFeatures);
    const { minX, minY, width, height } = sampleGeom.boundingBox;
    const pad = Math.max(width, height) * 0.18;
    const viewBox = `${minX - pad} ${minY - pad} ${width + 2 * pad} ${height + 2 * pad}`;
    const bentCat = template.category === 'bent_profile';

    return (
      <div
        key={template.id}
        onClick={() => onSelectTemplate(template)}
        className={`group relative bg-white border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 cursor-pointer hover:shadow-lg hover:-translate-y-1 ${
          isSelected ? 'border-[#FF3000] ring-2 ring-[#FF3000]/20 shadow-md shadow-[#FF3000]/10' : 'border-slate-200/90 hover:border-slate-300'
        }`}
      >
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-md tracking-wide ${
              bentCat ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-[#FF3000]/10 text-[#FF3000] border border-[#FF3000]/30'
            }`}>
              {bentCat ? 'Corte e dobra' : 'Corte'}
            </span>
            {isSelected && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#FF3000]">
                <CheckCircle2 className="w-3.5 h-3.5" /> <span>EM USO</span>
              </span>
            )}
          </div>

          <div className="w-full h-36 bg-slate-50 rounded-xl border border-slate-200 p-3 flex items-center justify-center mb-4 group-hover:border-slate-300 transition-colors overflow-hidden relative shadow-inner">
            <svg viewBox={viewBox} className="w-full h-full max-h-32 transition-transform group-hover:scale-105 duration-200">
              {sampleGeom.outerPolylines.map((p, idx) => (
                <path key={`out-${idx}`} d={polylineToSvgPath(p)} fill="#ffffff" stroke={isSelected ? '#FF3000' : '#1e293b'} strokeWidth="2.2" />
              ))}
              {sampleGeom.bendLines.map((b, bIdx) => (
                <line key={b.id || `bend-${bIdx}`} x1={b.positionX} y1={b.startY} x2={b.positionX} y2={b.endY} stroke="#0ea5e9" strokeWidth="2" strokeDasharray="5 3" />
              ))}
              {sampleGeom.innerPolylines.map((p, idx) => (
                <path key={`in-${idx}`} d={polylineToSvgPath(p)} fill="#f8fafc" stroke="#FF3000" strokeWidth="1.8" />
              ))}
              {sampleGeom.circles.map((c, idx) => (
                <circle key={`c-${idx}`} cx={c.center.x} cy={c.center.y} r={c.radius} fill="#f8fafc" stroke="#FF3000" strokeWidth="1.8" />
              ))}
            </svg>
            <span className="absolute bottom-1.5 right-2 text-[10px] font-mono text-slate-600 bg-white/90 px-1.5 py-0.5 rounded border border-slate-200 font-medium">
              {sampleGeom.metrics.blankWidthMm} × {sampleGeom.metrics.blankHeightMm} mm
            </span>
          </div>

          <h3 className="font-heading text-lg font-bold text-slate-900 group-hover:text-[#FF3000] transition-colors">{template.name}</h3>
          <p className="text-xs text-slate-600 font-sans line-clamp-2 mt-1 leading-relaxed">{template.description}</p>
        </div>

        <div className="mt-5 pt-3 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap gap-1">
            {bentCat && (
              <span className="px-1.5 py-0.5 text-[9px] font-medium bg-sky-50 text-sky-700 border border-sky-200 rounded">Fator K & Dedução</span>
            )}
            {template.compatibleFeatures.map((featId) => (
              <span key={featId} className="px-1.5 py-0.5 text-[9px] font-sans bg-slate-100 text-slate-600 border border-slate-200 rounded">
                {FEATURE_LABEL[featId] || featId}
              </span>
            ))}
          </div>
          <button className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
            isSelected ? 'bg-[#FF3000] text-white shadow-sm' : 'bg-slate-100 text-slate-700 group-hover:bg-[#FF3000] group-hover:text-white border border-slate-200 group-hover:border-[#FF3000]'
          }`}>
            <span>{isSelected ? 'Abrir no Configurador' : 'Configurar Geometria'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const Section: React.FC<{ title: string; subtitle: string; count: number; accent: 'sky' | 'red'; icon: React.ReactNode; items: TemplateDefinition[] }> = ({ title, subtitle, count, accent, icon, items }) => (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accent === 'sky' ? 'bg-sky-50 text-sky-600 border border-sky-200' : 'bg-[#FF3000]/10 text-[#FF3000] border border-[#FF3000]/20'}`}>
          {icon}
        </div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-900 font-heading flex items-center gap-2">
            {title}
            <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-slate-200 text-slate-700 rounded">{count}</span>
          </h2>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map(renderCard)}
      </div>
    </section>
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 text-slate-800">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Hero + busca/filtros */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="max-w-3xl">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-heading">
              Selecione o Modelo Base para Geração do DXF
            </h1>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed font-sans">
              Geometrias padronizadas e perfis dobrados com desdobramento analítico de blank (DIN 6935 / Fator K), contornos fechados (LWPOLYLINE) e camadas industriais prontas para corte a laser, plasma e dobra CNC.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-slate-100">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="input-catalog-search"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por perfil, flange, chapa ou código..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#FF3000] focus:bg-white focus:ring-1 focus:ring-[#FF3000]/30 transition shadow-inner"
              />
            </div>

            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs shrink-0">
              <button onClick={() => setSelectedCategory('all')} className={`px-3 py-2 rounded-lg font-semibold transition ${selectedCategory === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
                Todos ({TEMPLATES.length})
              </button>
              <button onClick={() => setSelectedCategory('bent_profile')} className={`px-3 py-2 rounded-lg font-semibold transition flex items-center gap-1.5 ${selectedCategory === 'bent_profile' ? 'bg-sky-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
                <FoldHorizontal className="w-3.5 h-3.5" /> <span>Dobrados ({bentTotal})</span>
              </button>
              <button onClick={() => setSelectedCategory('flat_sheet')} className={`px-3 py-2 rounded-lg font-semibold transition flex items-center gap-1.5 ${selectedCategory === 'flat_sheet' ? 'bg-[#FF3000] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
                <Square className="w-3.5 h-3.5" /> <span>Planas ({flatTotal})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Secoes agrupadas */}
        {nothing ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
            <Search className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-semibold text-slate-700">Nenhum modelo encontrado</p>
            <p className="text-xs mt-1">Ajuste a busca ou troque o filtro de categoria.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {showFlat && (
              <Section
                title="Chapas Planas"
                subtitle="Sem dobra - recorte 2D direto (chapas, flanges, discos e recortes especiais)."
                count={flat.length}
                accent="red"
                icon={<Square className="w-5 h-5" />}
                items={flat}
              />
            )}
            {showBent && (
              <Section
                title="Perfis Dobrados"
                subtitle="Com dobra - desdobramento de blank por Fator K e linhas de dobra."
                count={bent.length}
                accent="sky"
                icon={<FoldHorizontal className="w-5 h-5" />}
                items={bent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
