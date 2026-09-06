import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import {
  createSubscription, listCustomerSubscriptions, listSubscriptionsAdmin,
  updateSubscription, generateDueOrdersForTenant,
} from "./subscriptions.js";

describe("Suscripción de auto-envío — genera pedidos recurrentes (cobro al recibir)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;

  const customerId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "alimento", name: "Alimento Perro Adulto" });
      const v = await addVariant(tx, { tenantId, productId, sku: "AP-15KG", name: "15kg" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 1_000_000n }); // $10.000
      await setStock(tx, { tenantId, variantId: v.variantId, available: 10 });
      variantId = v.variantId;
      // Ficha de cliente para asociar la suscripción.
      await tx.query("insert into customers (id, tenant_id, name) values ($1,$2,'Joaco')", [customerId, tenantId]);
    });
  });
  afterAll(async () => { await pg?.close(); });

  // Vence la próxima corrida de una suscripción (la pone en el pasado).
  async function makeDue(subId: string) {
    await db.withTenant(tenantId, (tx) => tx.query("update subscriptions set next_run_at = now() - interval '1 hour' where id = $1", [subId]));
  }
  async function orderCount(): Promise<number> {
    const r = await db.withTenant(tenantId, (tx) => tx.query<{ n: string }>("select count(*)::text n from orders"));
    return Number(r[0]!.n);
  }

  it("crea una suscripción y la lista para el cliente", async () => {
    const res = await createSubscription(db, { tenantId, merchantId, variantId, qty: 2, intervalDays: 30, customerId, petName: "Bruno" });
    expect(res.ok).toBe(true);
    const subs = await db.withTenant(tenantId, (tx) => listCustomerSubscriptions(tx, customerId));
    expect(subs.length).toBe(1);
    expect(subs[0]!.qty).toBe(2);
    expect(subs[0]!.intervalDays).toBe(30);
    expect(subs[0]!.petName).toBe("Bruno");
  });

  it("genera el pedido cuando vence, con canal 'suscripcion', y NO duplica al re-correr", async () => {
    const res = await createSubscription(db, { tenantId, merchantId, variantId, qty: 1, intervalDays: 15, customerId });
    if (!res.ok) throw new Error(res.error);
    await makeDue(res.value.id);

    const before = await orderCount();
    const r1 = await generateDueOrdersForTenant(db, tenantId);
    expect(r1.created).toBe(1);
    expect(await orderCount()).toBe(before + 1);

    // El pedido quedó con canal 'suscripcion' y pago pendiente.
    const [ord] = await db.withTenant(tenantId, (tx) =>
      tx.query<{ channel: string; payment_status: string }>(
        "select channel, payment_status from orders order by created_at desc limit 1"),
    );
    expect(ord!.channel).toBe("suscripcion");
    expect(ord!.payment_status).toBe("pendiente");

    // Al re-correr inmediatamente NO vuelve a generar (next_run_at ya se movió al futuro).
    const r2 = await generateDueOrdersForTenant(db, tenantId);
    expect(r2.created).toBe(0);
    expect(await orderCount()).toBe(before + 1);
  });

  it("aplica el descuento de suscripción al precio del pedido", async () => {
    const res = await createSubscription(db, { tenantId, merchantId, variantId, qty: 1, intervalDays: 20, customerId, discountPercent: 10 });
    if (!res.ok) throw new Error(res.error);
    await makeDue(res.value.id);
    const r = await generateDueOrdersForTenant(db, tenantId);
    expect(r.created).toBe(1);
    const [item] = await db.withTenant(tenantId, (tx) =>
      tx.query<{ unit_price_minor: string | number }>(
        `select oi.unit_price_minor from order_items oi
           join seller_orders so on so.id = oi.seller_order_id
           join orders o on o.id = so.order_id
          where o.channel = 'suscripcion' order by o.created_at desc limit 1`),
    );
    expect(Number(item!.unit_price_minor)).toBe(900000); // $10.000 - 10% = $9.000
  });

  it("sin stock suficiente: salta el ciclo (last_error), no crea pedido", async () => {
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 0 }));
    const res = await createSubscription(db, { tenantId, merchantId, variantId, qty: 1, intervalDays: 25, customerId });
    if (!res.ok) throw new Error(res.error);
    await makeDue(res.value.id);
    const before = await orderCount();
    const r = await generateDueOrdersForTenant(db, tenantId);
    expect(r.created).toBe(0);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(await orderCount()).toBe(before);
    const [row] = await db.withTenant(tenantId, (tx) =>
      tx.query<{ last_error: string | null }>("select last_error from subscriptions where id = $1", [res.value.id]));
    expect(row!.last_error).toBe("sin_stock");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 10 })); // restaura
  });

  it("una suscripción pausada/cancelada no genera pedidos", async () => {
    const res = await createSubscription(db, { tenantId, merchantId, variantId, qty: 1, intervalDays: 10, customerId });
    if (!res.ok) throw new Error(res.error);
    await makeDue(res.value.id);
    await db.withTenant(tenantId, (tx) => updateSubscription(tx, res.value.id, { status: "paused" }));
    const before = await orderCount();
    const r = await generateDueOrdersForTenant(db, tenantId);
    expect(await orderCount()).toBe(before); // pausada → no entra en las due
    expect(r.created).toBe(0);
  });

  it("la vista admin lista todas las suscripciones con producto y cliente", async () => {
    const rows = await db.withTenant(tenantId, (tx) => listSubscriptionsAdmin(tx));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.productName).toBe("Alimento Perro Adulto");
    expect(rows.some((r) => r.customerName === "Joaco")).toBe(true);
  });
});
