import type { CurrencyCode } from "@commerce/contracts";
import { percentageOfBps } from "@commerce/platform";

export type AllocationTargetType = "merchant" | "platform_commission" | "delivery" | "psp_fee" | "promo_subsidy";

export interface Allocation {
  sellerOrderId?: string;
  targetType: AllocationTargetType;
  targetRef?: string;
  amountMinor: bigint;
}

export interface AllocationInput {
  currency: CurrencyCode;
  commissionBps: bigint;
  deliveryChargeMinor: bigint;
  sellerOrders: ReadonlyArray<{ sellerOrderId: string; merchantId: string; subtotalMinor: bigint }>;
}

/**
 * Reparte lo que paga el cliente (GMV + delivery) en allocations, PARTICIÓN EXACTA
 * (suman el total, sin perder centavos — D7). Por cada seller_order: comisión (floor del
 * %) va a la plataforma y el resto del GMV al comercio; el delivery es una allocation
 * única a la plataforma. Fórmula corregida de Fase 0: el GMV NO es ingreso de plataforma,
 * es la base de la comisión.
 */
export function computeAllocations(input: AllocationInput): { total: bigint; allocations: Allocation[] } {
  const allocations: Allocation[] = [];
  let gmv = 0n;

  for (const so of input.sellerOrders) {
    const commission = percentageOfBps({ amountMinor: so.subtotalMinor, currency: input.currency }, input.commissionBps)
      .amountMinor;
    const merchantAmount = so.subtotalMinor - commission;
    allocations.push({ sellerOrderId: so.sellerOrderId, targetType: "merchant", targetRef: so.merchantId, amountMinor: merchantAmount });
    allocations.push({ sellerOrderId: so.sellerOrderId, targetType: "platform_commission", amountMinor: commission });
    gmv += so.subtotalMinor;
  }

  if (input.deliveryChargeMinor > 0n) {
    allocations.push({ targetType: "delivery", amountMinor: input.deliveryChargeMinor });
  }

  const total = gmv + input.deliveryChargeMinor;
  return { total, allocations };
}
