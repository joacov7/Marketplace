import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, cancelOrder, transitionSellerOrder, orderAttentionSummary } from "./orders.js";

describe("orderAttentionSummary — aviso de pedidos nuevos", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "s", name: "S" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S1", name: "S" });
      await setStock(tx, { tenantId, variantId, available: 50 });
      return variantId;
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  const order = async (paymentMethod: "efectivo" | "online") => {
    const r = await createOrder(db, { tenantId, paymentMethod, sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 1000n }] }] });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const summary = () => db.withTenant(tenantId, (tx) => orderAttentionSummary(tx));

  it("cola vacía", async () => {
    expect(await summary()).toEqual({ needsAcceptance: 0, toPrepare: 0, latestOrderId: null, latestCreatedAt: null });
  });

  it("cuenta pagos al recibir por aceptar y confirmados sin preparar; el online sin pagar no cuenta", async () => {
    const a = await order("efectivo");
    let s = await summary();
    expect(s).toMatchObject({ needsAcceptance: 1, toPrepare: 0, latestOrderId: a.orderId });

    await order("online"); // sin pagar: invisible
    s = await summary();
    expect(s.latestOrderId).toBe(a.orderId);

    await confirmOrder(db, tenantId, a.orderId);
    expect(await summary()).toMatchObject({ needsAcceptance: 0, toPrepare: 1 });

    await transitionSellerOrder(db, tenantId, a.sellerOrderIds[0]!, "preparing");
    expect(await summary()).toMatchObject({ needsAcceptance: 0, toPrepare: 0 });

    const b = await order("efectivo");
    s = await summary();
    expect(s).toMatchObject({ needsAcceptance: 1, latestOrderId: b.orderId });
    expect(s.latestCreatedAt).not.toBeNull();

    await cancelOrder(db, tenantId, b.orderId); // rechazado: sale de la cola
    expect((await summary()).needsAcceptance).toBe(0);
  });
});
