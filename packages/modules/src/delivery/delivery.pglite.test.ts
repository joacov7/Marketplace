import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder } from "../orders/orders.js";
import { createDelivery, transitionDelivery, getDelivery, quoteDelivery } from "./delivery.js";

describe("Delivery — costeo, ciclo de entrega, subsidio", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  async function orderWithSeller(unitPrice: bigint): Promise<{ sellerOrderId: string; totalMinor: bigint }> {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + Math.random(), name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S" + Math.random(), name: "S" });
      await setStock(tx, { tenantId, variantId, available: 10 });
      return variantId;
    });
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: unitPrice }] }],
    });
    if (!created.ok) throw new Error(created.error);
    return { sellerOrderId: created.value.sellerOrderIds[0]!, totalMinor: created.value.totalMinor };
  }

  it("cotiza con defaults de config: cliente $1.500, cadete $2.500, subsidio $1.000", async () => {
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 3_000_000n }));
    expect(q.customerChargeMinor).toBe(150_000n);
    expect(q.cadeteCostMinor).toBe(250_000n);
    expect(q.subsidyMinor).toBe(100_000n);
    expect(q.subsidySource).toBe("platform");
  });

  it("delivery gratis sobre el umbral ($50.000): cliente $0, subsidio total", async () => {
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 6_000_000n }));
    expect(q.customerChargeMinor).toBe(0n);
    expect(q.subsidyMinor).toBe(250_000n);
  });

  it("crea la entrega de un seller_order y recorre el ciclo hasta delivered", async () => {
    const { sellerOrderId, totalMinor } = await orderWithSeller(3_000_000n);
    const created = await createDelivery(db, { tenantId, sellerOrderId, orderTotalMinor: totalMinor, etaMinutes: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.deliveryId;

    for (const to of ["assigned", "picked_up", "in_transit", "delivered"] as const) {
      const r = await transitionDelivery(db, { tenantId, deliveryId: id, to, ...(to === "assigned" ? {} : {}) });
      expect(r.ok).toBe(true);
    }
    const d = await db.withTenant(tenantId, (tx) => getDelivery(tx, id));
    expect(d?.status).toBe("delivered");
    expect(d?.customerChargeMinor).toBe(150_000n);
  });

  it("rechaza transiciones inválidas (pending → delivered)", async () => {
    const { sellerOrderId, totalMinor } = await orderWithSeller(1_000_000n);
    const created = await createDelivery(db, { tenantId, sellerOrderId, orderTotalMinor: totalMinor });
    if (!created.ok) throw new Error(created.error);
    const bad = await transitionDelivery(db, { tenantId, deliveryId: created.value.deliveryId, to: "delivered" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid_transition/);
  });

  it("una tarifa por zona pisa los defaults de config", async () => {
    const zoneId = await db.withTenant(tenantId, async (tx) => {
      const [z] = await tx.query<{ id: string }>(
        "insert into delivery_zones (tenant_id, name) values ($1,'centro') returning id",
        [tenantId],
      );
      await tx.query(
        "insert into delivery_rates (tenant_id, zone_id, cadete_cost_minor, customer_charge_minor, subsidy_source) values ($1,$2,300000,200000,'merchant')",
        [tenantId, z!.id],
      );
      return z!.id;
    });
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 3_000_000n, zoneId }));
    expect(q.cadeteCostMinor).toBe(300_000n);
    expect(q.customerChargeMinor).toBe(200_000n);
    expect(q.subsidySource).toBe("merchant");
  });
});
