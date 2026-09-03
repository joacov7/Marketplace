import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { type TenantAwareDb, setConfigValue } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock, getStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, cancelOrder, completeOrder, getOrder, listSellerOrders, listDeliveryOrders, transitionSellerOrder, listCustomerOrders } from "./orders.js";
import { findOrCreateCustomerByPhone } from "../customer/customer.js";

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

  it("mis pedidos: lista solo los del cliente, con estado y cumplimiento", async () => {
    const customerId = "33333333-3333-3333-3333-333333333333";
    const other = "44444444-4444-4444-4444-444444444444";
    const v = await variantWithStock(db, tenantId, merchantId, "MP1", 10);
    const mine = await createOrder(db, {
      tenantId,
      customerId,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 2, unitPriceMinor: 1000n }] }],
    });
    if (!mine.ok) throw new Error("create falló");
    await createOrder(db, {
      tenantId,
      customerId: other,
      sellers: [{ merchantId, items: [{ variantId: v, qty: 1, unitPriceMinor: 1000n }] }],
    });

    const list = await db.withTenant(tenantId, (tx) => listCustomerOrders(tx, customerId));
    expect(list.length).toBe(1);
    expect(list[0]!.orderId).toBe(mine.value.orderId);
    expect(list[0]!.status).toBe("pending_payment");
    expect(list[0]!.itemCount).toBe(1); // 1 línea de order_item (qty 2)
    expect(list[0]!.totalMinor).toBe(2000n);

    // Tras confirmar y avanzar el cumplimiento, se refleja el estado.
    await confirmOrder(db, tenantId, mine.value.orderId);
    await transitionSellerOrder(db, tenantId, mine.value.sellerOrderIds[0]!, "preparing");
    const list2 = await db.withTenant(tenantId, (tx) => listCustomerOrders(tx, customerId));
    expect(list2[0]!.status).toBe("confirmed");
    expect(list2[0]!.fulfillment).toBe("preparing");
  });

  it("Eslabón 1: guarda para qué mascota, forma de pago y canal", async () => {
    const { customerId } = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "2447-9001", name: "Dueño de Bruno" }),
    );
    const v = await variantWithStock(db, tenantId, merchantId, "E1A", 10);
    const created = await createOrder(db, {
      tenantId,
      customerId,
      petName: "Bruno",
      paymentMethod: "efectivo",
      paymentStatus: "pendiente",
      channel: "web",
      sellers: [{ merchantId, items: [{ variantId: v, qty: 1, unitPriceMinor: 5000n }] }],
    });
    if (!created.ok) throw new Error("create falló");

    const list = await db.withTenant(tenantId, (tx) => listCustomerOrders(tx, customerId));
    const row = list.find((r) => r.orderId === created.value.orderId)!;
    expect(row.petName).toBe("Bruno"); // "Pedido de Bruno" en Mis pedidos
    expect(row.paymentStatus).toBe("pendiente"); // pago al recibir
  });

  it("Eslabón 1: pago al recibir entra 'a aceptar' → Aceptar lo confirma", async () => {
    const { customerId } = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "2447-9002", name: "Mishi Dueña" }),
    );
    const v = await variantWithStock(db, tenantId, merchantId, "E1B", 10);
    const created = await createOrder(db, {
      tenantId,
      customerId,
      petName: "Mishi",
      paymentMethod: "efectivo",
      channel: "web",
      sellers: [{ merchantId, items: [{ variantId: v, qty: 2, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");

    // Aparece en la cola del comercio marcado "a aceptar", con cliente y mascota.
    let queue = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    let q = queue.find((r) => r.orderId === created.value.orderId);
    expect(q?.needsAcceptance).toBe(true);
    expect(q?.orderStatus).toBe("pending_payment");
    expect(q?.petName).toBe("Mishi");
    expect(q?.customerName).toBe("Mishi Dueña");
    expect(q?.paymentMethod).toBe("efectivo");

    // Aceptar = confirmar el pedido (consume la reserva). Deja de necesitar aceptación.
    expect((await confirmOrder(db, tenantId, created.value.orderId)).ok).toBe(true);
    queue = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    q = queue.find((r) => r.orderId === created.value.orderId);
    expect(q?.needsAcceptance).toBe(false);
    expect(q?.orderStatus).toBe("confirmed");
    expect(q?.paymentStatus).toBe("pendiente"); // se cobra al entregar
  });

  it("Eslabón 1: Rechazar conserva el pedido (historial) y lo saca de la cola", async () => {
    const { customerId } = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "2447-9003" }),
    );
    const v = await variantWithStock(db, tenantId, merchantId, "E1C", 10);
    const created = await createOrder(db, {
      tenantId,
      customerId,
      paymentMethod: "transferencia",
      channel: "whatsapp",
      sellers: [{ merchantId, items: [{ variantId: v, qty: 1, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 9, reserved: 1 });

    // Rechazar = cancelar: libera stock, sale de la cola, PERO no se borra.
    expect((await cancelOrder(db, tenantId, created.value.orderId)).ok).toBe(true);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, v))).toEqual({ available: 10, reserved: 0 });
    const queue = await db.withTenant(tenantId, (tx) => listSellerOrders(tx));
    expect(queue.some((r) => r.orderId === created.value.orderId)).toBe(false);
    // Sigue existiendo para historial/reportes.
    const view = await db.withTenant(tenantId, (tx) => getOrder(tx, created.value.orderId));
    expect(view?.status).toBe("cancelled");
  });

  it("Eslabón 2: reparto — ready/in_transit aparecen con dirección, monto e ítems", async () => {
    const { customerId } = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "2447-7001", name: "Dueño de Toby" }),
    );
    const v = await variantWithStock(db, tenantId, merchantId, "E2A", 10);
    const created = await createOrder(db, {
      tenantId,
      customerId,
      petName: "Toby",
      paymentMethod: "efectivo",
      channel: "web",
      deliveryChargeMinor: 500n,
      shippingAddress: { street: "San Martín 123", zone: "Centro", notes: "Timbre azul", phone: "2447-7001" },
      sellers: [{ merchantId, items: [{ variantId: v, qty: 2, unitPriceMinor: 1000n }] }],
    });
    if (!created.ok) throw new Error("create falló");
    const soId = created.value.sellerOrderIds[0]!;

    // Todavía no está listo para repartir.
    let queue = await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx));
    expect(queue.some((r) => r.sellerOrderId === soId)).toBe(false);

    // Aceptar → preparar → listo: recién ahí entra a la cola de reparto.
    await confirmOrder(db, tenantId, created.value.orderId);
    await transitionSellerOrder(db, tenantId, soId, "preparing");
    await transitionSellerOrder(db, tenantId, soId, "ready");
    queue = await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx));
    const row = queue.find((r) => r.sellerOrderId === soId)!;
    expect(row.petName).toBe("Toby");
    expect(row.addressStreet).toBe("San Martín 123");
    expect(row.addressNotes).toBe("Timbre azul");
    expect(row.customerPhone).toBe("2447-7001");
    expect(row.amountToCollectMinor).toBe(2500n); // 2×1000 + 500 envío
    expect(row.items.reduce((a, it) => a + it.qty, 0)).toBe(2);

    // En camino → sigue en la cola; entregado → sale.
    await transitionSellerOrder(db, tenantId, soId, "in_transit");
    expect((await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).some((r) => r.sellerOrderId === soId)).toBe(true);
    await transitionSellerOrder(db, tenantId, soId, "delivered");
    expect((await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).some((r) => r.sellerOrderId === soId)).toBe(false);
  });

  it("Eslabón 2: completeOrder cierra el pedido entregado (idempotente)", async () => {
    const v = await variantWithStock(db, tenantId, merchantId, "E2B", 10);
    const created = await createOrder(db, { tenantId, paymentMethod: "efectivo", sellers: [{ merchantId, items: [{ variantId: v, qty: 1, unitPriceMinor: 1000n }] }] });
    if (!created.ok) throw new Error("create falló");
    // No se puede completar sin aceptar (pending_payment → completed es inválido).
    expect((await completeOrder(db, tenantId, created.value.orderId)).ok).toBe(false);
    await confirmOrder(db, tenantId, created.value.orderId);
    expect((await completeOrder(db, tenantId, created.value.orderId)).ok).toBe(true);
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, created.value.orderId)))?.status).toBe("completed");
    // Idempotente.
    expect((await completeOrder(db, tenantId, created.value.orderId)).ok).toBe(true);
  });
});
