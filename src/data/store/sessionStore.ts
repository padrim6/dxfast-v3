// DXFAST :: Persistencia de sessao (carrinho e peca atual sobrevivem ao F5)
// Camada isolada na pasta data/store, unica dona da chave de sessao no navegador.
// Tolera localStorage indisponivel sem quebrar. Proibido o caractere traco-longo.

import { CartItem } from '../../quote/cartQuote';
import { ClientInfo } from '../../types/admin';

// Chaves separadas: a peca/tela muda a cada slider (barato de gravar), enquanto o
// carrinho so muda ao adicionar/editar (geometria e pesada, so grava quando muda).
const DESIGN_KEY = 'dxfast.session.v1';
const CART_KEY = 'dxfast.session.cart.v1';
const CLIENT_KEY = 'dxfast.client.v1';
const SCHEMA_VERSION = 1;

export interface SessionDesign {
  templateId: string;
  partName: string;
  params: Record<string, number>;
  features: Record<string, any>;
}

export interface SessionState {
  activeScreen?: string;
  design?: SessionDesign | null;
  cart?: CartItem[];
}

export const sessionStore = {
  load(): SessionState | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const out: SessionState = {};
      const dTxt = localStorage.getItem(DESIGN_KEY);
      if (dTxt) {
        const d = JSON.parse(dTxt);
        if (d && d.schemaVersion === SCHEMA_VERSION) { out.activeScreen = d.activeScreen; out.design = d.design; }
      }
      const cTxt = localStorage.getItem(CART_KEY);
      if (cTxt) {
        const c = JSON.parse(cTxt);
        if (c && c.schemaVersion === SCHEMA_VERSION && Array.isArray(c.cart)) out.cart = c.cart;
      }
      return (out.design || out.cart || out.activeScreen) ? out : null;
    } catch {
      return null;
    }
  },
  saveDesign(activeScreen: string | undefined, design: SessionDesign | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DESIGN_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, activeScreen, design }));
    } catch {
      // ignora
    }
  },
  saveCart(cart: CartItem[]): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(CART_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, cart }));
    } catch {
      // carrinho grande demais para o armazenamento: ignora (nao persiste)
    }
  },
  clear(): void {
    try {
      if (typeof localStorage !== 'undefined') { localStorage.removeItem(DESIGN_KEY); localStorage.removeItem(CART_KEY); }
    } catch {
      // ignora
    }
  },

  // Ultimo cliente usado numa proposta, para nao reescrever a cada vez.
  loadClient(): ClientInfo | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const txt = localStorage.getItem(CLIENT_KEY);
      return txt ? (JSON.parse(txt) as ClientInfo) : null;
    } catch {
      return null;
    }
  },
  saveClient(c: ClientInfo): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(CLIENT_KEY, JSON.stringify(c));
    } catch {
      // ignora
    }
  },
};
