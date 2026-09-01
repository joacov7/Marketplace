import type { CurrencyCode } from "@commerce/contracts";

export interface ProductHit {
  variantId: string;
  name: string;
  productName: string;
  priceMinor: bigint | null;
  currency: CurrencyCode | null;
  available: number;
}

export interface RepurchaseHit {
  variantId: string;
  name: string;
  times: number;
  lastAt: string;
}

export interface ProposedCartItem {
  variantId: string;
  name: string;
  qty: number;
  unitPriceMinor: bigint;
}

/**
 * Carrito PROPUESTO por el agente. Es inerte: no es un pedido. Requiere que el humano lo
 * confirme (vía /api/checkout). `requiresHumanConfirmation` es siempre true.
 */
export interface ProposedCart {
  items: ProposedCartItem[];
  totalMinor: bigint;
  currency: CurrencyCode;
  withinBudget: boolean;
  budgetMinor: bigint | null;
}

export interface AgentQuery {
  tenantId: string;
  customerId?: string;
  message: string;
  budgetMinor?: bigint;
}

export interface AgentResponse {
  reply: string;
  proposedCart: ProposedCart | null;
  usedTools: string[];
  /** Marca de propose-only: ninguna acción de dinero ocurrió; el humano debe confirmar. */
  requiresHumanConfirmation: true;
}
