// Aplica las migraciones SQL contra la base de DATABASE_URL, en orden. Idempotente:
// las tablas usan `if not exists` y las policies se crean solo si no existen, así que se
// puede re-ejecutar sin romper. Uso: DATABASE_URL=... node scripts/migrate.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const files = [
  "packages/platform/src/db/migrations/0000_init.sql",
  "packages/modules/src/catalog/migrations/0001_catalog_inventory.sql",
  "packages/modules/src/orders/migrations/0002_orders.sql",
  "packages/modules/src/payments/migrations/0003_payments.sql",
  "packages/modules/src/delivery/migrations/0004_delivery.sql",
  "packages/platform/src/db/migrations/0005_auth.sql",
  "packages/modules/src/customer/migrations/0006_customer.sql",
  "packages/modules/src/orders/migrations/0007_orders_checkout.sql",
  "packages/modules/src/catalog/migrations/0008_product_images.sql",
  "packages/modules/src/catalog/migrations/0009_categories.sql",
  "packages/modules/src/adoptions/migrations/0010_adoptions.sql",
];

const sql = postgres(url, { max: 1, prepare: false, onnotice: (n) => console.log("  ·", n.message) });
try {
  for (const f of files) {
    console.log("Aplicando", f);
    await sql.unsafe(readFileSync(f, "utf8"));
  }
  console.log("Migraciones aplicadas OK");
} catch (e) {
  console.error("Error aplicando migraciones:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
