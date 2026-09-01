import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder } from "../orders/orders.js";
import { FakePaymentProvider } from "../payments/provider.js";
import { createPaymentIntent, capturePayment } from "../payments/payments.js";
import { salesSummary, topProducts, stockAlerts, salesByDay } from "./reports.js";

describe("Reports — resumen de ventas, top productos, alertas de stock (RLS)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  const provider = new FakePaymentProvider();

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  /** Crea un producto con precio + stock y devuelve su variante. */
  async function newVariant(name: string, priceMinor: bigint, stock: number): Promise<string> {
    return db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + name + Math.random(), name });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S" + Math.random(), name });
      await setPrice(tx, { tenantId, variantId, amountMinor: priceMinor, currency: "ARS" });
      await setStock(tx, { tenantId, variantId, available: stock });
      return variantId;
    });
  }

  /** Compra pagada de `qty` unidades de una variante a `unitPriceMinor`. */
  async function paidOrder(variantId: string, qty: number, unitPriceMinor: bigint, key: string): Promise<void> {
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId, qty, unitPriceMinor }] }],
    });
    if (!created.ok) throw new Error("createOrder falló: " + created.error);
    const intent = await createPaymentIntent(db, provider, { tenantId, orderId: created.value.orderId, idempotencyKey: key });
    if (!intent.ok) throw new Error("intent falló: " + intent.error);
    const cap = await capturePayment(db, { tenantId, providerEventId: "evt-" + key, providerRef: intent.value.providerRef });
    if (!cap.ok) throw new Error("capture falló: " + cap.error);
  }

  it("resume GMV, comisión y payout desde el ledger; top productos y serie diaria", async () => {
    const alimento = await newVariant("Alimento", 1_000_000n, 100); // $10.000
    const juguete = await newVariant("Juguete", 500_000n, 100); // $5.000
    await paidOrder(alimento, 3, 1_000_000n, "o1"); // GMV 3.000.000
    await paidOrder(juguete, 1, 500_000n, "o2"); // GMV 500.000

    const s = await db.withTenant(tenantId, (tx) => salesSummary(tx));
    expect(s.paidOrders).toBe(2);
    expect(s.gmvMinor).toBe(3_500_000n);
    // Comisión 7% del GMV = 245.000; payout = GMV - comisión = 3.255.000.
    expect(s.commissionMinor).toBe(245_000n);
    expect(s.merchantPayoutMinor).toBe(3_255_000n);
    // Envío: gratis sobre umbral en o1 (3.000.000) y cobrado en o2 (500.000) según config.
    expect(s.deliveryRevenueMinor).toBeGreaterThanOrEqual(0n);
    expect(s.refundsMinor).toBe(0n);

    const top = await db.withTenant(tenantId, (tx) => topProducts(tx, { limit: 5 }));
    expect(top[0]!.productName).toBe("Alimento"); // 3 unidades > 1
    expect(top[0]!.unitsSold).toBe(3);
    expect(top[0]!.revenueMinor).toBe(3_000_000n);
    expect(top.find((t) => t.productName === "Juguete")!.unitsSold).toBe(1);

    const series = await db.withTenant(tenantId, (tx) => salesByDay(tx, { days: 7 }));
    expect(series.length).toBe(1); // todo hoy
    expect(series[0]!.orders).toBe(2);
    expect(series[0]!.gmvMinor).toBe(3_500_000n);
  });

  it("alerta stock bajo del umbral", async () => {
    await newVariant("CasiSinStock", 100_000n, 2);
    const alerts = await db.withTenant(tenantId, (tx) => stockAlerts(tx, { threshold: 5 }));
    expect(alerts.some((a) => a.productName === "CasiSinStock" && a.available === 2)).toBe(true);
    // Los de stock 100 no aparecen.
    expect(alerts.every((a) => a.available <= 5)).toBe(true);
  });
});
