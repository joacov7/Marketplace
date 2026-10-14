import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock, getStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, transitionSellerOrder, getOrder, listSellerOrders } from "./orders.js";

/**
 * Cancelar/rechazar un pedido YA aceptado: tiene que devolver el stock y cancelar el pedido
 * (antes solo cambiaba la etiqueta del seller_order: el stock quedaba perdido y el pedido
 * seguía 'confirmed', contando como venta).
 */
describe("transitionSellerOrder — cancelar un pedido aceptado compensa", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "c", name: "C" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "C1", name: "C" });
      await setStock(tx, { tenantId, variantId, available: 10 });
      return variantId;
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  const stock = () => db.withTenant(tenantId, (tx) => getStock(tx, variantId));
  const orderStatus = async (orderId: string) => (await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))!.status;
  const accepted = async (qty: number, paymentStatus: "pendiente" | "pagado" = "pendiente") => {
    const r = await createOrder(db, {
      tenantId,
      paymentMethod: "efectivo",
      paymentStatus,
      sellers: [{ merchantId, items: [{ variantId, qty, unitPriceMinor: 1000n }] }],
    });
    if (!r.ok) throw new Error(r.error);
    expect((await confirmOrder(db, tenantId, r.value.orderId)).ok).toBe(true);
    return r.value;
  };

  it("rechazar un aceptado (pending): repone stock y cancela el pedido", async () => {
    const before = await stock();
    const o = await accepted(3);
    expect(await stock()).toEqual({ available: before!.available - 3, reserved: before!.reserved });

    const r = await transitionSellerOrder(db, tenantId, o.sellerOrderIds[0]!, "rejected");
    expect(r.ok).toBe(true);
    expect(await stock()).toEqual(before);
    expect(await orderStatus(o.orderId)).toBe("cancelled");
    // Sale de la cola del comercio.
    const queue = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    expect(queue.find((q) => q.orderId === o.orderId)).toBeUndefined();
  });

  it("cancelar en preparación o listo también repone, y no repone dos veces", async () => {
    const before = await stock();
    const o = await accepted(2);
    const so = o.sellerOrderIds[0]!;
    await transitionSellerOrder(db, tenantId, so, "preparing");
    await transitionSellerOrder(db, tenantId, so, "ready");
    expect((await transitionSellerOrder(db, tenantId, so, "cancelled")).ok).toBe(true);
    expect(await stock()).toEqual(before);
    expect(await orderStatus(o.orderId)).toBe("cancelled");
    // Repetir la cancelación es inválido (terminal) y no toca el stock.
    expect((await transitionSellerOrder(db, tenantId, so, "cancelled")).ok).toBe(false);
    expect(await stock()).toEqual(before);
  });

  it("pedido sin aceptar (reserva held) rechazado por esta vía: libera la reserva", async () => {
    const before = await stock();
    const r = await createOrder(db, { tenantId, paymentMethod: "efectivo", sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 1000n }] }] });
    if (!r.ok) throw new Error(r.error);
    expect((await stock())!.reserved).toBe(before!.reserved + 1);
    expect((await transitionSellerOrder(db, tenantId, r.value.sellerOrderIds[0]!, "rejected")).ok).toBe(true);
    expect(await stock()).toEqual(before);
    expect(await orderStatus(r.value.orderId)).toBe("cancelled");
  });

  it("pedido cobrado: no se cancela sin confirmar la devolución; con confirmación, sí", async () => {
    const before = await stock();
    const o = await accepted(1, "pagado");
    const so = o.sellerOrderIds[0]!;
    const blocked = await transitionSellerOrder(db, tenantId, so, "rejected");
    expect(blocked).toEqual({ ok: false, error: "paid_refund_required" });
    expect(await orderStatus(o.orderId)).toBe("confirmed");
    expect((await stock())!.available).toBe(before!.available - 1);

    expect((await transitionSellerOrder(db, tenantId, so, "rejected", { refundAcknowledged: true })).ok).toBe(true);
    expect(await stock()).toEqual(before);
    expect(await orderStatus(o.orderId)).toBe("cancelled");
  });

  it("avanzar (no cancelar) no toca stock ni el estado del pedido", async () => {
    const o = await accepted(1);
    const mid = await stock();
    await transitionSellerOrder(db, tenantId, o.sellerOrderIds[0]!, "preparing");
    expect(await stock()).toEqual(mid);
    expect(await orderStatus(o.orderId)).toBe("confirmed");
  });
});
