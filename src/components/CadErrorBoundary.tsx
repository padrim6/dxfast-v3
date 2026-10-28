import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface CadErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  resetKeys?: any[];
}

interface CadErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class CadErrorBoundary extends Component<CadErrorBoundaryProps, CadErrorBoundaryState> {
  declare props: CadErrorBoundaryProps;
  declare state: CadErrorBoundaryState;
  declare setState: (
    state: Partial<CadErrorBoundaryState> | ((prevState: Readonly<CadErrorBoundaryState>, props: Readonly<CadErrorBoundaryProps>) => Partial<CadErrorBoundaryState> | null),
    callback?: () => void
  ) => void;

  constructor(props: CadErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): CadErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('CadErrorBoundary caught a rendering error:', error, errorInfo);
  }

  public componentDidUpdate(prevProps: CadErrorBoundaryProps) {
    if (this.state.hasError && this.props.resetKeys && prevProps.resetKeys) {
      const keysChanged = this.props.resetKeys.some(
        (key, index) => key !== prevProps.resetKeys?.[index]
      );
      if (keysChanged) {
        this.handleReset();
      }
    }
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          id="cad-error-boundary-fallback"
          className="w-full h-[520px] bg-[#0b0f19] rounded-xl border border-red-900/50 p-6 flex flex-col items-center justify-center text-center select-none shadow-2xl"
        >
          <div className="w-14 h-14 rounded-full bg-red-950/80 border border-red-800/80 flex items-center justify-center mb-4 text-red-400 shadow-inner">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <h3 className="text-base font-bold text-white font-heading mb-1">
            {this.props.fallbackTitle || 'Falha na Renderização 3D / CAD'}
          </h3>

          <p className="text-xs text-slate-400 max-w-md mb-4 leading-relaxed font-sans">
            Ocorreu uma exceção inesperada durante o processamento ou exibição gráfica do modelo.
            Seus parâmetros foram preservados.
          </p>

          {this.state.error?.message && (
            <div className="w-full max-w-lg bg-slate-950/90 border border-slate-800/90 rounded-lg p-3 mb-5 text-left overflow-auto max-h-28">
              <span className="text-[10px] font-mono text-slate-500 block mb-1 uppercase tracking-wider">
                Detalhes do Erro:
              </span>
              <code className="text-xs font-mono text-red-300 block whitespace-pre-wrap break-words">
                {this.state.error.message}
              </code>
            </div>
          )}

          <button
            id="btn-retry-cad-rendering"
            type="button"
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF3000] hover:bg-[#e02b00] active:scale-95 text-white text-xs font-semibold font-mono tracking-wide shadow-lg shadow-[#FF3000]/20 transition-all cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Tentar Novamente</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
