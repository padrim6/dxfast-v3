import React from 'react';
import {
  LayoutGrid,
  SlidersHorizontal,
  ShoppingCart,
  Settings,
  Download,
  FileText,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  FileInput,
  Plus,
  History,
} from 'lucide-react';
import { TemplateDefinition } from '../types/cad';
import { DxFastIcon } from './DxFastLogo';

type Screen = 'library' | 'workspace' | 'admin' | 'cart' | 'history';

interface HeaderProps {
  currentTemplate: TemplateDefinition;
  partName: string;
  activeScreen: Screen;
  cartCount?: number;
  onNavigateToLibrary: () => void;
  onNavigateToWorkspace: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToCart: () => void;
  onNavigateToHistory: () => void;
  onImportDxf?: () => void;
  onAddToCart?: () => void;
  onExportDxf: () => void;
  onExportPdf?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSaveProject?: () => void;
  onOpenProject?: () => void;
  isExportBlocked?: boolean;
  isRecalculating?: boolean;
}

// estilos reutilizaveis (sistema de botoes consistente)
const ICON_BTN = 'tap-target flex items-center justify-center w-9 h-9 rounded-lg transition border';
const GHOST = 'tap-target flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-semibold transition border bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-xs';
const PRIMARY = 'tap-target flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-xs font-bold transition shadow-sm bg-[#FF3000] hover:bg-[#e62b00] text-white active:scale-95';

export const Header: React.FC<HeaderProps> = ({
  partName,
  activeScreen,
  cartCount = 0,
  onNavigateToLibrary,
  onNavigateToWorkspace,
  onNavigateToAdmin,
  onNavigateToCart,
  onNavigateToHistory,
  onImportDxf,
  onAddToCart,
  onExportDxf,
  onExportPdf,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onSaveProject,
  onOpenProject,
  isExportBlocked = false,
  isRecalculating = false,
}) => {
  const NavItem: React.FC<{ screen: Screen; label: string; icon: React.ReactNode; onClick: () => void; badge?: number }> = ({ screen, label, icon, onClick, badge }) => {
    const active = activeScreen === screen;
    return (
      <button
        onClick={onClick}
        className={`tap-target relative flex items-center gap-1.5 px-2.5 lg:px-3 h-9 rounded-lg text-xs font-semibold transition ${
          active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-white'
        }`}
        aria-current={active ? 'page' : undefined}
        title={label}
      >
        <span className={active ? 'text-[#FF3000]' : 'text-slate-400'}>{icon}</span>
        <span className="hidden lg:inline">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="ml-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-[#FF3000] text-white text-[10px] font-bold leading-none">{badge}</span>
        )}
      </button>
    );
  };

  return (
    <header className="sticky top-0 z-50 bg-white/95 border-b border-slate-200 text-slate-800 backdrop-blur shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex items-center justify-between gap-3 flex-wrap">
        {/* Esquerda: marca + switcher de modulos */}
        <div className="flex items-center gap-3 lg:gap-5">
          <div onClick={onNavigateToLibrary} className="flex items-center gap-2.5 cursor-pointer group shrink-0">
            <div className="w-9 h-9 rounded-xl overflow-hidden shadow-md shadow-red-500/20 transition-transform group-hover:scale-105">
              <DxFastIcon size={36} rounded={false} />
            </div>
            <span className="text-xl font-black tracking-tight text-[#FF3000] leading-none hidden sm:inline">
              DX<span className="font-normal tracking-normal ml-0.5">FAST</span>
            </span>
          </div>

          {/* Switcher de modulos */}
          <nav className="flex items-center gap-0.5 bg-slate-100 border border-slate-200 rounded-xl p-1">
            <NavItem screen="library" label="Biblioteca" icon={<LayoutGrid className="w-4 h-4" />} onClick={onNavigateToLibrary} />
            <NavItem screen="workspace" label="Configurador" icon={<SlidersHorizontal className="w-4 h-4" />} onClick={onNavigateToWorkspace} />
            <NavItem screen="cart" label="Carrinho" icon={<ShoppingCart className="w-4 h-4" />} onClick={onNavigateToCart} badge={cartCount} />
            <NavItem screen="history" label="Histórico" icon={<History className="w-4 h-4" />} onClick={onNavigateToHistory} />
            <NavItem screen="admin" label="Admin" icon={<Settings className="w-4 h-4" />} onClick={onNavigateToAdmin} />
          </nav>
        </div>

        {/* Direita: acoes contextuais */}
        <div className="flex items-center gap-2">
          {/* Importar DXF: disponivel na biblioteca e no carrinho */}
          {(activeScreen === 'library' || activeScreen === 'cart') && onImportDxf && (
            <button onClick={onImportDxf} className={PRIMARY} title="Importar um arquivo DXF para medir e orçar">
              <FileInput className="w-4 h-4" />
              <span className="hidden sm:inline">Importar DXF</span>
            </button>
          )}
          {activeScreen === 'library' && onOpenProject && (
            <button onClick={onOpenProject} className={GHOST} title="Abrir projeto salvo (.dxfast.json)">
              <FolderOpen className="w-4 h-4 text-slate-500" />
              <span className="hidden md:inline">Abrir</span>
            </button>
          )}

          {activeScreen === 'workspace' && (
            <>
              {/* Historico */}
              <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden shadow-xs">
                <button onClick={onUndo} disabled={!canUndo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)"
                  className={`tap-target w-9 h-9 flex items-center justify-center transition ${canUndo ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}>
                  <Undo2 className="w-4 h-4" />
                </button>
                <button onClick={onRedo} disabled={!canRedo} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)"
                  className={`tap-target w-9 h-9 flex items-center justify-center border-l border-slate-200 transition ${canRedo ? 'bg-white hover:bg-slate-50 text-slate-700' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}>
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
              {/* Projeto */}
              <div className="hidden sm:flex items-center rounded-lg border border-slate-200 overflow-hidden shadow-xs">
                {onOpenProject && (
                  <button onClick={onOpenProject} aria-label="Abrir projeto" title="Abrir projeto (.dxfast.json)" className="tap-target w-9 h-9 flex items-center justify-center bg-white hover:bg-slate-50 text-slate-600">
                    <FolderOpen className="w-4 h-4" />
                  </button>
                )}
                {onSaveProject && (
                  <button onClick={onSaveProject} aria-label="Salvar projeto" title="Salvar projeto (.dxfast.json)" className="tap-target w-9 h-9 flex items-center justify-center border-l border-slate-200 bg-white hover:bg-slate-50 text-slate-600">
                    <Save className="w-4 h-4" />
                  </button>
                )}
              </div>
              {/* Adicionar ao carrinho */}
              {onAddToCart && (
                <button onClick={onAddToCart} className={GHOST} title="Adicionar esta peça ao carrinho de corte">
                  <Plus className="w-4 h-4 text-[#FF3000]" />
                  <span className="hidden md:inline">Carrinho</span>
                </button>
              )}
              {/* Exportacoes */}
              {onExportPdf && (
                <button onClick={onExportPdf} disabled={isExportBlocked}
                  className={`tap-target flex items-center gap-1.5 px-3 h-9 text-xs font-bold rounded-lg border transition shadow-xs ${isExportBlocked ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed shadow-none' : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'}`}
                  title={isRecalculating ? 'Atualizando geometria...' : isExportBlocked ? 'Exportação bloqueada: corrija as inconsistências' : 'Baixar Desenho Técnico em PDF (A4)'}>
                  <FileText className={`w-4 h-4 ${isExportBlocked ? 'text-slate-400' : 'text-[#FF3000]'}`} />
                  <span className="hidden sm:inline">PDF</span>
                </button>
              )}
              <button onClick={onExportDxf} disabled={isExportBlocked}
                className={`tap-target flex items-center gap-1.5 px-3.5 h-9 text-xs font-bold rounded-lg shadow-sm transition ${isExportBlocked ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-[#FF3000] hover:bg-[#e62b00] text-white active:scale-95'}`}
                title={isRecalculating ? 'Atualizando geometria...' : isExportBlocked ? 'Exportação bloqueada: corrija as inconsistências' : 'Baixar Arquivo DXF R2000'}>
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">DXF</span>
              </button>
            </>
          )}
        </div>
      </div>
      {/* nome da peca ativa (contexto discreto) */}
      {(activeScreen === 'workspace') && partName && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-1.5 -mt-0.5">
          <span className="text-[11px] text-slate-400 font-mono">Peça ativa: <span className="text-slate-600 font-semibold">{partName}</span></span>
        </div>
      )}
    </header>
  );
};
