import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder, listDeliveryOrders, confirmOrder, transitionSellerOrder } from "./orders.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(here, "migrations", "0022_fix_jsonb_strings.sql"), "utf8");

describe("0022 — reparación de direcciones guardadas como string JSON", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "j", name: "J" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "J1", name: "J" });
      await setStock(tx, { tenantId, variantId, available: 20 });
      return variantId;
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  const readyOrder = async (address: Record<string, unknown>) => {
    const r = await createOrder(db, { tenantId, paymentMethod: "efectivo", shippingAddress: address, sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 1000n }] }] });
    if (!r.ok) throw new Error(r.error);
    await confirmOrder(db, tenantId, r.value.orderId);
    await transitionSellerOrder(db, tenantId, r.value.sellerOrderIds[0]!, "preparing");
    await transitionSellerOrder(db, tenantId, r.value.sellerOrderIds[0]!, "ready");
    return r.value.orderId;
  };

  it("createOrder guarda la dirección como objeto (el reparto la ve)", async () => {
    const id = await readyOrder({ street: "San Martín 123", zone: "Centro", notes: "portón verde" });
    const [row] = await db.withTenant(tenantId, (tx) => tx.query<{ t: string }>("select jsonb_typeof(shipping_address) t from orders where id = $1", [id]));
    expect(row!.t).toBe("object");
    const d = (await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).find((o) => o.orderId === id);
    expect(d).toMatchObject({ addressStreet: "San Martín 123", addressZone: "Centro", addressNotes: "portón verde" });
  });

  it("repara filas viejas doble-codificadas, respetando RLS, sin tocar las sanas ni lo que no es JSON", async () => {
    const broken = await readyOrder({ street: "x" });
    const healthy = await readyOrder({ street: "Belgrano 50" });
    const garbage = await readyOrder({ street: "y" });
    // Simula lo que dejó postgres.js en producción (y una fila con texto que no es JSON).
    await db.withTenant(tenantId, async (tx) => {
      await tx.query(`update orders set shipping_address = to_jsonb('{"street":"Rivadavia 9","lat":-33.1}'::text) where id = $1`, [broken]);
      await tx.query(`update orders set shipping_address = to_jsonb('no es json'::text) where id = $1`, [garbage]);
    });
    await db.query(`insert into outbox_events (tenant_id, type, payload) values ($1, 'x', to_jsonb('{"orderId":"o1"}'::text))`, [tenantId]);

    const before = (await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).find((o) => o.orderId === broken);
    expect(before?.addressStreet).toBeNull(); // el bug: "Sin dirección"

    // Corre como el rol de la app (no superusuario) → sujeto a FORCE RLS, como en Neon.
    await pg.transaction(async (t) => {
      await t.query("set local role commerce_app");
      await t.exec(MIGRATION);
    });

    const after = await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx));
    expect(after.find((o) => o.orderId === broken)).toMatchObject({ addressStreet: "Rivadavia 9", addressLat: -33.1 });
    expect(after.find((o) => o.orderId === healthy)?.addressStreet).toBe("Belgrano 50");
    const [g] = await db.withTenant(tenantId, (tx) => tx.query<{ t: string }>("select jsonb_typeof(shipping_address) t from orders where id = $1", [garbage]));
    expect(g!.t).toBe("string"); // no era JSON: se deja igual
    const [o] = await db.query<{ t: string }>("select jsonb_typeof(payload) t from outbox_events where type = 'x'");
    expect(o!.t).toBe("object");

    // Idempotente
    await pg.transaction(async (t) => {
      await t.query("set local role commerce_app");
      await t.exec(MIGRATION);
    });
    expect((await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).find((x) => x.orderId === broken)?.addressStreet).toBe("Rivadavia 9");
  });
});
