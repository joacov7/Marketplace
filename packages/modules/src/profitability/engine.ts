/**
 * Profitability Engine (puro). Implementa la fórmula CORREGIDA de Fase 0 ([D-ERR]):
 * el GMV NO es ingreso de la plataforma, es la base de la comisión. Separa dos P&L:
 * contribución de la PLATAFORMA y contribución del COMERCIO. Todo en centavos.
 */

const bps = (amount: bigint, rateBps: bigint): bigint => (amount * rateBps) / 10_000n;

export interface PlatformContributionInput {
  gmvMinor: bigint;
  commissionBps: bigint;
  /** Lo que paga el cliente por delivery. */
  deliveryChargeMinor: bigint;
  /** Costo real de la entrega (cadete). */
  cadeteCostMinor: bigint;
  adsMinor?: bigint;
  saasMinor?: bigint;
  /** PSP absorbido por la plataforma (default 0: en MP Split lo paga el comercio). */
  pspFeePlatformMinor?: bigint;
  promoPlatformMinor?: bigint;
  aiCostMinor?: bigint;
  otherMinor?: bigint;
}

export interface PlatformContribution {
  commissionMinor: bigint;
  deliveryMarginMinor: bigint;
  contributionMinor: bigint;
}

/**
 * Contribución de la plataforma por pedido:
 *   comisión + margen_logístico + ads + saas − PSP_plataforma − promo − IA − otros
 * (el GMV solo entra como base de la comisión, nunca como sumando).
 */
export function computePlatformContribution(i: PlatformContributionInput): PlatformContribution {
  const commission = bps(i.gmvMinor, i.commissionBps);
  const deliveryMargin = i.deliveryChargeMinor - i.cadeteCostMinor; // negativo si subsidiada
  const contribution =
    commission +
    deliveryMargin +
    (i.adsMinor ?? 0n) +
    (i.saasMinor ?? 0n) -
    (i.pspFeePlatformMinor ?? 0n) -
    (i.promoPlatformMinor ?? 0n) -
    (i.aiCostMinor ?? 0n) -
    (i.otherMinor ?? 0n);
  return { commissionMinor: commission, deliveryMarginMinor: deliveryMargin, contributionMinor: contribution };
}

export interface MerchantContributionInput {
  gmvMinor: bigint;
  /** Margen bruto del comercio sobre el GMV. */
  marginBps: bigint;
  commissionBps: bigint;
  /** PSP que absorbe el comercio (default: 5,5% del GMV si se pasa pspFeeBps). */
  pspFeeBps?: bigint;
  deliverySubsidyMerchantMinor?: bigint;
  promoMerchantMinor?: bigint;
}

export interface MerchantContribution {
  grossMarginMinor: bigint;
  commissionMinor: bigint;
  pspFeeMinor: bigint;
  contributionMinor: bigint;
}

/**
 * Contribución del comercio por pedido (vista del Simulador):
 *   margen_bruto − comisión − PSP − subsidio_delivery_comercio − promo_comercio
 */
export function computeMerchantContribution(i: MerchantContributionInput): MerchantContribution {
  const grossMargin = bps(i.gmvMinor, i.marginBps);
  const commission = bps(i.gmvMinor, i.commissionBps);
  const psp = i.pspFeeBps ? bps(i.gmvMinor, i.pspFeeBps) : 0n;
  const contribution =
    grossMargin - commission - psp - (i.deliverySubsidyMerchantMinor ?? 0n) - (i.promoMerchantMinor ?? 0n);
  return { grossMarginMinor: grossMargin, commissionMinor: commission, pspFeeMinor: psp, contributionMinor: contribution };
}

/** Pedidos/mes para cubrir un costo fijo dado una contribución por pedido (break-even). */
export function breakEvenOrders(fixedMonthlyMinor: bigint, contributionPerOrderMinor: bigint): number | null {
  if (contributionPerOrderMinor <= 0n) return null; // no alcanza el break-even con contribución <= 0
  return Number((fixedMonthlyMinor + contributionPerOrderMinor - 1n) / contributionPerOrderMinor); // ceil
}
