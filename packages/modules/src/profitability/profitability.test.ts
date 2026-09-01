import { describe, it, expect } from "vitest";
import {
  computePlatformContribution,
  computeMerchantContribution,
  breakEvenOrders,
} from "./engine.js";
import { computeScenarios } from "./simulator.js";

// Números base de Fase 0 (L4): ticket $30.000 = 3.000.000 c; comisión 7% = 700 bps;
// margen comercio 30% = 3000 bps; PSP 5,5% = 550 bps; delivery cliente $1.500 = 150.000;
// cadete $2.500 = 250.000; IA $100 = 10.000.

describe("Profitability Engine — fórmula corregida (Fase 0)", () => {
  it("contribución de la PLATAFORMA: 7% + subsidio parcial → $1.000/pedido", () => {
    const r = computePlatformContribution({
      gmvMinor: 3_000_000n,
      commissionBps: 700n,
      deliveryChargeMinor: 150_000n,
      cadeteCostMinor: 250_000n,
      aiCostMinor: 10_000n,
    });
    expect(r.commissionMinor).toBe(210_000n);
    expect(r.deliveryMarginMinor).toBe(-100_000n); // subsidiada
    expect(r.contributionMinor).toBe(100_000n); // $1.000
  });

  it("el GMV NO es sumando (regresión del error del doc): quitar delivery/IA no suma GMV", () => {
    const r = computePlatformContribution({ gmvMinor: 3_000_000n, commissionBps: 700n, deliveryChargeMinor: 0n, cadeteCostMinor: 0n });
    expect(r.contributionMinor).toBe(210_000n); // solo la comisión, no 3.000.000+
  });

  it("contribución del COMERCIO: $5.250/pedido", () => {
    const r = computeMerchantContribution({ gmvMinor: 3_000_000n, marginBps: 3000n, commissionBps: 700n, pspFeeBps: 550n });
    expect(r.grossMarginMinor).toBe(900_000n);
    expect(r.contributionMinor).toBe(525_000n); // 900.000 - 210.000 - 165.000
  });

  it("break-even: $500.000/mes de costo fijo con $1.000/pedido → 500 pedidos", () => {
    expect(breakEvenOrders(50_000_000n, 100_000n)).toBe(500);
    expect(breakEvenOrders(50_000_000n, 0n)).toBe(null); // contribución <= 0
  });
});

describe("Merchant Simulator — 3 escenarios", () => {
  const input = {
    ticketMinor: 3_000_000n,
    marginBps: 3000n,
    commissionBps: 700n,
    pspFeeBps: 550n,
    baselineOrdersPerMonth: 100,
    platformOrdersPerMonth: 200,
    agentUpliftBps: 1500n, // +15% de pedidos por el agente (supuesto editable)
    deliveryChargeMinor: 150_000n,
    cadeteCostMinor: 250_000n,
    aiCostPerOrderMinor: 10_000n,
    platformFixedMonthlyMinor: 50_000_000n,
  };

  it("per-order coincide con el engine", () => {
    const out = computeScenarios(input);
    expect(out.perOrder.merchantContributionMinor).toBe(525_000n);
    expect(out.perOrder.platformContributionMinor).toBe(100_000n);
    expect(out.platformBreakEvenOrders).toBe(500);
  });

  it("con plataforma + agent mejora sobre con plataforma, y ambos sobre baseline", () => {
    const out = computeScenarios(input);
    const [sin, con, agent] = out.scenarios;
    expect(con!.incrementalSalesMinor).toBeGreaterThan(sin!.incrementalSalesMinor);
    expect(agent!.incrementalSalesMinor).toBeGreaterThan(con!.incrementalSalesMinor);
    expect(agent!.platformMonthlyContributionMinor).toBeGreaterThan(con!.platformMonthlyContributionMinor);
    // agente: 200 + 15% = 230 pedidos incrementales
    expect(agent!.ordersPerMonth).toBe(100 + 230);
    expect(con!.platformMonthlyContributionMinor).toBe(200n * 100_000n); // 20.000.000
    expect(agent!.platformMonthlyContributionMinor).toBe(230n * 100_000n); // 23.000.000
  });
});
