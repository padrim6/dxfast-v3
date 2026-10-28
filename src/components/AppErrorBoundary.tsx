// DXFAST :: Barreira de erro de topo (ultima rede de seguranca do app inteiro)
// Se qualquer tela lancar uma excecao de renderizacao, em vez de tela branca o
// usuario ve uma mensagem clara e botoes para continuar. Nao apaga nada sozinho:
// a configuracao e saneada na camada de dados, entao recarregar costuma resolver.
// Proibido o caractere traco-longo.

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  declare props: Props;
  declare state: State;
  declare setState: (s: Partial<State>) => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AppErrorBoundary capturou um erro de renderizacao:', error, info);
  }

  handleRetry = () => this.setState({ hasError: false, error: null });
  handleReload = () => { try { window.location.reload(); } catch { /* ignora */ } };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-10">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-slate-200 p-7 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mb-4 mx-auto text-red-500">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-2">Algo saiu do lugar nesta tela</h1>
          <p className="text-sm text-slate-500 leading-relaxed mb-5">
            Encontramos uma falha ao montar esta parte do aplicativo. Seus dados cadastrados
            continuam salvos neste navegador. Tente novamente ou recarregue a pagina.
          </p>
          {this.state.error?.message && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-left overflow-auto max-h-24">
              <code className="text-xs font-mono text-red-500 block whitespace-pre-wrap break-words">
                {this.state.error.message}
              </code>
            </div>
          )}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF3000] hover:bg-red-600 text-white text-sm font-semibold transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Tentar novamente
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Recarregar a pagina
            </button>
          </div>
        </div>
      </div>
    );
  }
}
