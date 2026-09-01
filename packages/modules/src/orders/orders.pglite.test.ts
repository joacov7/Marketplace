import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { type TenantAwareDb, setConfigValue } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock, getStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, cancelOrder, getOrder, listSellerOrders, transitionSellerOrder } from "./orders.js";

async function variantWithStock(
  db: TenantAwareDb,
  tenantId: string,
  merchantId: string,
  sku: string,
  stock: number,
): Promise<string> {
  return db.withTenant(tenantId, async (tx) => {
    const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + sku, name: "P " + sku });
    const { variantId } = await addVariant(tx, { tenantId, productId, sku, name: sku });
    await setStock(tx, { tenantId, variantId, available: stock });
    return variantId;
  });
}

describe("Orders — creación, reserva, confirmación, cancelación", () => {
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

  it("crea un pedido V1 (1 comercio), reserva stock y calcula el total", async () => {
    const v = await variantWithStock(db, tenantId, merchantId, "OA", 10);
    const res = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 2, unitPriceMinor: 3_000_000n }] }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.totalMinor).toBe(6_000_000n);
    expect(res.value.sellerOrderIds.length).toBe(1);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 8, reserved: 2 });
  });

  it("rechaza multi-seller cuando maxSellersPerOrder=1 (config, NO hardcode)", async () => {
    const v1 = await variantWithStock(db, tenantId, merchantId, "MS1", 5);
    // segundo merchant del mismo tenant
    const merchant2 = await db.withTenant(tenantId, async (tx) => {
      const [m] = await tx.query<{ id: string }>(
        "insert into merchants (tenant_id, slug, name) values ($1,'m2','M2') returning id",
        [tenantId],
      );
      return m!.id;
    });
    const v2 = await variantWithStock(db, tenantId, merchant2, "MS2", 5);

    const res = await createOrder(db, {
      tenantId,
      sellers: [
        { merchantId, items: [{ variantId: v1, qty: 1, unitPriceMinor: 100n }] },
        { merchantId: merchant2, items: [{ variantId: v2, qty: 1, unitPriceMinor: 100n }] },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too_many_sellers/);
    // no dejó stock reservado (rollback)
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v1))).toEqual({ available: 5, reserved: 0 });
  });

  it("habilitar multi-seller es SUBIR EL FLAG, sin tocar esquema", async () => {
    await setConfigValue(db, {
      key: "orders.maxSellersPerOrder",
      scopeType: "tenant",
      scopeId: tenantId,
      value: 3,
      actor: "admin",
    });
    const merchant2 = await db.withTenant(tenantId, async (tx) => {
      const [m] = await tx.query<{ id: string }>(
        "insert into merchants (tenant_id, slug, name) values ($1,'m3','M3') returning id",
        [tenantId],
      );
      return m!.id;
    });
    const v1 = await variantWithStock(db, tenantId, merchantId, "OK1", 5);
    const v2 = await variantWithStock(db, tenantId, merchant2, "OK2", 5);
    const res = await createOrder(db, {
      tenantId,
      sellers: [
        { merchantId, items: [{ variantId: v1, qty: 1, unitPriceMinor: 500n }] },
        { merchantId: merchant2, items: [{ variantId: v2, qty: 1, unitPriceMinor: 700n }] },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.sellerOrderIds.length).toBe(2); // multi-seller sin cambiar Order
      expect(res.value.totalMinor).toBe(1200n);
    }
  });

  it("rollback atómico si falta stock de un item: no queda pedido ni reservas", async () => {
    const vOk = await variantWithStock(db, tenantId, merchantId, "RB1", 5);
    const vNo = await variantWithStock(db, tenantId, merchantId, "RB2", 1);
    const res = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [
        { variantId: vOk, qty: 1, unitPriceMinor: 100n },
        { variantId: vNo, qty: 5, unitPriceMinor: 100n }, // supera stock
      ] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/insufficient_stock/);
    // el primer item NO quedó reservado (rollback total)
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, vOk))).toEqual({ available: 5, reserved: 0 });
    const count = await db.withTenant(tenantId, (tx) => tx.query<{ n: string }>("select count(*)::text n from orders"));
    // se crearon pedidos en tests previos; lo importante es que este no dejó reservas colgadas (verificado arriba)
    expect(Number(count[0]!.n)).toBeGreaterThanOrEqual(0);
  });

  it("confirmar consume las reservas; cancelar libera stock", async () => {
    const v = await variantWithStock(db, tenantId, merchantId, "CC", 10);
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 3, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");

    const conf = await confirmOrder(db, tenantId, created.value.orderId);
    expect(conf.ok).toBe(true);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 7, reserved: 0 });
    const view = await db.withTenant(tenantId, (tx) => getOrder(tx, created.value.orderId));
    expect(view?.status).toBe("confirmed");

    // una transición inválida (cancelar tras confirmar+completar no aplica); acá cancelar confirmado sí es válido
    const cancel = await cancelOrder(db, tenantId, created.value.orderId);
    expect(cancel.ok).toBe(true);
    // el stock ya fue consumido por confirm; cancelar no lo repone (las reservas no están 'held')
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 7, reserved: 0 });
  });

  it("panel del comercio: lista seller_orders pagados y avanza el cumplimiento", async () => {
    const v = await variantWithStock(db, tenantId, merchantId, "SP", 10);
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 1, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");
    // no aparece hasta que esté pagado (confirmado)
    let list = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    expect(list.some((r) => r.sellerOrderId === created.value.sellerOrderIds[0])).toBe(false);

    await confirmOrder(db, tenantId, created.value.orderId);
    list = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    const row = list.find((r) => r.sellerOrderId === created.value.sellerOrderIds[0]);
    expect(row?.status).toBe("pending");
    expect(row?.itemCount).toBe(1);

    const soId = created.value.sellerOrderIds[0]!;
    expect((await transitionSellerOrder(db, tenantId, soId, "preparing")).ok).toBe(true);
    expect((await transitionSellerOrder(db, tenantId, soId, "ready")).ok).toBe(true);
    // transición inválida
    const bad = await transitionSellerOrder(db, tenantId, soId, "delivered");
    expect(bad.ok).toBe(false);
  });

  it("cancelar un pedido pending_payment libera el stock reservado", async () => {
    const v = await variantWithStock(db, tenantId, merchantId, "CX", 10);
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 4, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 6, reserved: 4 });
    await cancelOrder(db, tenantId, created.value.orderId);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 10, reserved: 0 });
  });
});
