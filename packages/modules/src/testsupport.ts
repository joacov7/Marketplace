import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { freshDb } from "../../platform/src/db/pglite.testsupport.js";
import type { TenantAwareDb } from "@commerce/platform";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Crea una PGlite con la migración base (platform) + las de estos módulos aplicadas.
 * Solo para tests (los módulos son dueños de sus migraciones; se componen acá).
 */
export async function freshModulesDb(): Promise<{ pg: PGlite; db: TenantAwareDb }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalog = readFileSync(join(here, "catalog", "migrations", "0001_catalog_inventory.sql"), "utf8");
  const orders = readFileSync(join(here, "orders", "migrations", "0002_orders.sql"), "utf8");
  const payments = readFileSync(join(here, "payments", "migrations", "0003_payments.sql"), "utf8");
  const delivery = readFileSync(join(here, "delivery", "migrations", "0004_delivery.sql"), "utf8");
  const customer = readFileSync(join(here, "customer", "migrations", "0006_customer.sql"), "utf8");
  const ordersCheckout = readFileSync(join(here, "orders", "migrations", "0007_orders_checkout.sql"), "utf8");
  return freshDb([catalog, orders, payments, delivery, customer, ordersCheckout]);
}

/** Crea un tenant + merchant listos para tests de catálogo/inventario. */
export async function seedTenantMerchant(
  db: TenantAwareDb,
): Promise<{ tenantId: string; merchantId: string }> {
  const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('t','T') returning id");
  const tenantId = t!.id;
  const merchantId = await db.withTenant(tenantId, async (tx) => {
    const [m] = await tx.query<{ id: string }>(
      "insert into merchants (tenant_id, slug, name) values ($1,'petshop','Pet Shop') returning id",
      [tenantId],
    );
    return m!.id;
  });
  return { tenantId, merchantId };
}
