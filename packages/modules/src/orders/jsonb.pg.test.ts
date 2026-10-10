import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { pgDb, setConfigValue, resolveConfigValue, enqueueEvent, type TenantAwareDb } from "@commerce/platform";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, transitionSellerOrder, listDeliveryOrders } from "./orders.js";
// @ts-expect-error — lista de migraciones del deploy (módulo .mjs sin tipos)
import { MIGRATION_FILES } from "../../../../scripts/migrations-list.mjs";

/**
 * Con el DRIVER DE PRODUCCIÓN (postgres.js) contra un Postgres real: las columnas jsonb se
 * guardan como objeto/valor, no como string JSON. PGlite (los demás tests) no reproduce el bug,
 * por eso este test existe. Se salta sin TEST_DATABASE_URL (en CI corre si está el secret).
 * Usar una base de PRUEBA: aplica las migraciones y crea datos.
 */
const url = process.env.TEST_DATABASE_URL;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe.skipIf(!url)("jsonb con postgres.js (driver de producción)", () => {
  let sql: postgres.Sql;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;

  beforeAll(async () => {
    sql = postgres(url!, { max: 2, prepare: false, onnotice: () => {} });
    for (const [, file] of MIGRATION_FILES as Array<[string, string]>) await sql.unsafe(readFileSync(join(root, file), "utf8"));
    db = pgDb(sql);
    const [t] = await db.query<{ id: string }>("insert into tenants (slug, name) values ($1, 'J') returning id", [`jsonb-${Date.now()}`]);
    tenantId = t!.id;
    merchantId = await db.withTenant(tenantId, async (tx) => {
      const [m] = await tx.query<{ id: string }>("insert into merchants (tenant_id, slug, name) values ($1,'m','M') returning id", [tenantId]);
      return m!.id;
    });
    variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p", name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "P1", name: "P" });
      await setStock(tx, { tenantId, variantId, available: 5 });
      return variantId;
    });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("la dirección del pedido queda como objeto y el reparto la ve", async () => {
    const r = await createOrder(db, {
      tenantId,
      paymentMethod: "efectivo",
      shippingAddress: { street: "San Martín 123", zone: "Centro", lat: -33.14, lng: -59.31 },
      sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 1000n }] }],
    });
    if (!r.ok) throw new Error(r.error);
    await confirmOrder(db, tenantId, r.value.orderId);
    await transitionSellerOrder(db, tenantId, r.value.sellerOrderIds[0]!, "preparing");
    await transitionSellerOrder(db, tenantId, r.value.sellerOrderIds[0]!, "ready");

    const [row] = await db.withTenant(tenantId, (tx) => tx.query<{ t: string }>("select jsonb_typeof(shipping_address) t from orders where id = $1", [r.value.orderId]));
    expect(row!.t).toBe("object");
    const d = (await db.withTenant(tenantId, (tx) => listDeliveryOrders(tx))).find((o) => o.orderId === r.value.orderId);
    expect(d).toMatchObject({ addressStreet: "San Martín 123", addressZone: "Centro", addressLat: -33.14 });
  });

  it("la config guarda el tipo real: apagar una función da false", async () => {
    const set = (key: string, value: unknown) =>
      setConfigValue(db, { key, scopeType: "tenant", scopeId: tenantId, value, actor: "test", reason: "test" });
    await set("features.aiAssistant", false);
    await set("delivery.customerChargeMinor", 175000);
    await set("ops.deliveryPin", "482915");
    const get = async (key: string) => (await resolveConfigValue<unknown>(db, key, { tenantId })).value;
    expect(await get("features.aiAssistant")).toBe(false);
    expect(await get("delivery.customerChargeMinor")).toBe(175000);
    expect(await get("ops.deliveryPin")).toBe("482915");
    const rows = await db.query<{ key: string; t: string }>(
      "select key, jsonb_typeof(value) t from config_values where scope_id = $1 and actor = 'test'",
      [tenantId],
    );
    expect(Object.fromEntries(rows.map((x) => [x.key, x.t]))).toEqual({
      "features.aiAssistant": "boolean",
      "delivery.customerChargeMinor": "number",
      "ops.deliveryPin": "string",
    });
  });

  it("filas viejas doble-codificadas en config se leen con el tipo correcto", async () => {
    // Lo que dejó el driver antes del arreglo: un string JSON con el valor adentro.
    await db.query(
      `insert into config_values (key, scope_type, scope_id, value, version, effective_from, actor)
       values ('features.adoptions','tenant',$1, to_jsonb('false'::text), 1, now() - interval '1 minute', 'legacy')`,
      [tenantId],
    );
    expect((await resolveConfigValue<unknown>(db, "features.adoptions", { tenantId })).value).toBe(false);
  });

  it("los eventos del outbox guardan el payload como objeto", async () => {
    await db.withTenant(tenantId, (tx) => enqueueEvent(tx, { tenantId, type: "jsonb.test", payload: { a: 1 } }));
    const [o] = await db.query<{ t: string }>("select jsonb_typeof(payload) t from outbox_events where type = 'jsonb.test' and tenant_id = $1", [tenantId]);
    expect(o!.t).toBe("object");
  });
});
