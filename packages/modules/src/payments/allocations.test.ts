import { describe, it, expect } from "vitest";
import { computeAllocations } from "./allocations.js";

describe("computeAllocations — partición exacta (fórmula corregida Fase 0)", () => {
  it("un seller: comisión 7% a plataforma, resto del GMV al comercio, + delivery", () => {
    // GMV $30.000 = 3.000.000 c; comisión 700 bps = 210.000; delivery $1.500 = 150.000
    const { total, allocations } = computeAllocations({
      currency: "ARS",
      commissionBps: 700n,
      deliveryChargeMinor: 150_000n,
      sellerOrders: [{ sellerOrderId: "so1", merchantId: "m1", subtotalMinor: 3_000_000n }],
    });
    const merchant = allocations.find((a) => a.targetType === "merchant")!;
    const commission = allocations.find((a) => a.targetType === "platform_commission")!;
    const delivery = allocations.find((a) => a.targetType === "delivery")!;
    expect(commission.amountMinor).toBe(210_000n);
    expect(merchant.amountMinor).toBe(2_790_000n); // GMV - comisión
    expect(delivery.amountMinor).toBe(150_000n);
    // partición EXACTA: suma = GMV + delivery = lo que paga el cliente
    expect(total).toBe(3_150_000n);
    expect(allocations.reduce((a, x) => a + x.amountMinor, 0n)).toBe(total);
  });

  it("multi-seller: comisión por cada seller_order, partición sigue cerrando", () => {
    const { total, allocations } = computeAllocations({
      currency: "ARS",
      commissionBps: 700n,
      deliveryChargeMinor: 0n,
      sellerOrders: [
        { sellerOrderId: "so1", merchantId: "m1", subtotalMinor: 1_000_000n },
        { sellerOrderId: "so2", merchantId: "m2", subtotalMinor: 2_345_679n }, // fuerza redondeo
      ],
    });
    expect(total).toBe(3_345_679n);
    expect(allocations.reduce((a, x) => a + x.amountMinor, 0n)).toBe(total); // sin perder centavos
  });

  it("sin delivery no genera allocation de delivery", () => {
    const { allocations } = computeAllocations({
      currency: "ARS",
      commissionBps: 700n,
      deliveryChargeMinor: 0n,
      sellerOrders: [{ sellerOrderId: "so1", merchantId: "m1", subtotalMinor: 100_000n }],
    });
    expect(allocations.some((a) => a.targetType === "delivery")).toBe(false);
  });
});
