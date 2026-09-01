import {
  computeMerchantContribution,
  computePlatformContribution,
  breakEvenOrders,
} from "./engine.js";

/**
 * Merchant Simulator (sección 9 del doc). Tres escenarios: sin plataforma / con
 * plataforma / con plataforma + Agent Core. El uplift del agente es un SUPUESTO editable
 * (no una promesa — advertencia de honestidad de Fase 0). Todo en centavos.
 */
export interface SimulatorInput {
  ticketMinor: bigint;
  marginBps: bigint;
  commissionBps: bigint;
  pspFeeBps: bigint;
  baselineOrdersPerMonth: number;
  /** Pedidos incrementales que trae la plataforma por mes. */
  platformOrdersPerMonth: number;
  /** Uplift de pedidos por el Agent Core (recompra/recomendación), en bps. Supuesto. */
  agentUpliftBps: bigint;
  deliveryChargeMinor: bigint;
  cadeteCostMinor: bigint;
  aiCostPerOrderMinor?: bigint;
  /** Costo fijo mensual de la plataforma (para break-even). */
  platformFixedMonthlyMinor?: bigint;
}

export interface Scenario {
  name: "sin_plataforma" | "con_plataforma" | "con_plataforma_agent";
  ordersPerMonth: number;
  incrementalSalesMinor: bigint;
  merchantMonthlyContributionMinor: bigint;
  platformMonthlyContributionMinor: bigint;
}

export interface SimulatorOutput {
  perOrder: {
    merchantContributionMinor: bigint;
    platformContributionMinor: bigint;
    merchantBaselineContributionMinor: bigint;
  };
  scenarios: Scenario[];
  /** Pedidos/mes para que la plataforma cubra su costo fijo. null si contribución <= 0. */
  platformBreakEvenOrders: number | null;
}

export function computeScenarios(i: SimulatorInput): SimulatorOutput {
  const merchantContribPerOrder = computeMerchantContribution({
    gmvMinor: i.ticketMinor,
    marginBps: i.marginBps,
    commissionBps: i.commissionBps,
    pspFeeBps: i.pspFeeBps,
  }).contributionMinor;

  // Baseline: el comercio vende sin plataforma → solo margen bruto (sin comisión ni PSP de plataforma).
  const merchantBaselinePerOrder = (i.ticketMinor * i.marginBps) / 10_000n;

  const platformContribPerOrder = computePlatformContribution({
    gmvMinor: i.ticketMinor,
    commissionBps: i.commissionBps,
    deliveryChargeMinor: i.deliveryChargeMinor,
    cadeteCostMinor: i.cadeteCostMinor,
    ...(i.aiCostPerOrderMinor !== undefined ? { aiCostMinor: i.aiCostPerOrderMinor } : {}),
  }).contributionMinor;

  const boostedOrders =
    i.platformOrdersPerMonth + Math.floor((i.platformOrdersPerMonth * Number(i.agentUpliftBps)) / 10_000);

  const base = BigInt(i.baselineOrdersPerMonth) * merchantBaselinePerOrder;

  const scenarios: Scenario[] = [
    {
      name: "sin_plataforma",
      ordersPerMonth: i.baselineOrdersPerMonth,
      incrementalSalesMinor: 0n,
      merchantMonthlyContributionMinor: base,
      platformMonthlyContributionMinor: 0n,
    },
    {
      name: "con_plataforma",
      ordersPerMonth: i.baselineOrdersPerMonth + i.platformOrdersPerMonth,
      incrementalSalesMinor: BigInt(i.platformOrdersPerMonth) * i.ticketMinor,
      merchantMonthlyContributionMinor: base + BigInt(i.platformOrdersPerMonth) * merchantContribPerOrder,
      platformMonthlyContributionMinor: BigInt(i.platformOrdersPerMonth) * platformContribPerOrder,
    },
    {
      name: "con_plataforma_agent",
      ordersPerMonth: i.baselineOrdersPerMonth + boostedOrders,
      incrementalSalesMinor: BigInt(boostedOrders) * i.ticketMinor,
      merchantMonthlyContributionMinor: base + BigInt(boostedOrders) * merchantContribPerOrder,
      platformMonthlyContributionMinor: BigInt(boostedOrders) * platformContribPerOrder,
    },
  ];

  return {
    perOrder: {
      merchantContributionMinor: merchantContribPerOrder,
      platformContributionMinor: platformContribPerOrder,
      merchantBaselineContributionMinor: merchantBaselinePerOrder,
    },
    scenarios,
    platformBreakEvenOrders:
      i.platformFixedMonthlyMinor !== undefined
        ? breakEvenOrders(i.platformFixedMonthlyMinor, platformContribPerOrder)
        : null,
  };
}
