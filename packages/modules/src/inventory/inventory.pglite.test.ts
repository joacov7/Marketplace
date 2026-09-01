import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import {
  setStock,
  getStock,
  reserveStock,
  confirmReservation,
  releaseReservation,
  releaseExpiredReservations,
} from "./inventory.js";

async function newVariant(db: TenantAwareDb, tenantId: string, merchantId: string, sku: string): Promise<string> {
  return db.withTenant(tenantId, async (tx) => {
    const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + sku, name: "P " + sku });
    const { variantId } = await addVariant(tx, { tenantId, productId, sku, name: sku });
    return variantId;
  });
}

describe("Inventario — reserva atómica (anti-oversell [G1])", () => {
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

  it("no permite reservar más de lo disponible (sin oversell) y no toca el stock al fallar", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "STOCK-3");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 3 }));

    const okRes = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 2 }));
    expect(okRes.ok).toBe(true);

    const fail = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 2 }));
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.error).toBe("insufficient_stock");

    const stock = await db.withTenant(tenantId, (tx) => getStock(tx, variantId));
    expect(stock).toEqual({ available: 1, reserved: 2 }); // el intento fallido no descontó
  });

  it("agota exactamente el stock: la reserva que pasa el límite falla", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "STOCK-1");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 1 }));

    const r1 = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 1 }));
    const r2 = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 1 }));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    const stock = await db.withTenant(tenantId, (tx) => getStock(tx, variantId));
    expect(stock).toEqual({ available: 0, reserved: 1 });
  });

  it("confirmar una reserva la consume (baja reserved, available queda)", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "CONF-5");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 5 }));
    const res = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 2 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const conf = await db.withTenant(tenantId, (tx) => confirmReservation(tx, res.value.reservationId));
    expect(conf.ok).toBe(true);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 3, reserved: 0 });
    // confirmar de nuevo no hace nada (idempotencia de estado)
    const again = await db.withTenant(tenantId, (tx) => confirmReservation(tx, res.value.reservationId));
    expect(again.ok).toBe(false);
  });

  it("liberar una reserva devuelve el stock a available", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "REL-5");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 5 }));
    const res = await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 4 }));
    if (!res.ok) throw new Error("reserve falló");
    await db.withTenant(tenantId, (tx) => releaseReservation(tx, res.value.reservationId));
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 5, reserved: 0 });
  });

  it("el barrido de reservas vencidas devuelve el stock", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "EXP-5");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 5 }));
    await db.withTenant(tenantId, (tx) => reserveStock(tx, { tenantId, variantId, qty: 3, ttlSeconds: -1 })); // ya vencida
    expect((await db.withTenant(tenantId, (tx) => getStock(tx, variantId)))).toEqual({ available: 2, reserved: 3 });
    const released = await releaseExpiredReservations(db);
    expect(released).toBeGreaterThanOrEqual(1);
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 5, reserved: 0 });
  });

  it("no se puede reservar stock de una variante de otro tenant (RLS → no_inventory)", async () => {
    const variantId = await newVariant(db, tenantId, merchantId, "XT-9");
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 9 }));
    // otro tenant
    const [t2] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('t2','T2') returning id");
    const other = t2!.id;
    const res = await db.withTenant(other, (tx) => reserveStock(tx, { tenantId: other, variantId, qty: 1 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("no_inventory");
  });
});
