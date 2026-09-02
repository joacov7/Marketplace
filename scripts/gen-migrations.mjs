// Genera apps/web/lib/migrations.generated.ts embebiendo el SQL de las migraciones,
// para poder correrlas desde un route handler en Vercel (sin leer archivos en runtime).
// Regenerar tras cambiar cualquier migración: node scripts/gen-migrations.mjs
import { readFileSync, writeFileSync } from "node:fs";

const files = [
  ["0000_init", "packages/platform/src/db/migrations/0000_init.sql"],
  ["0001_catalog_inventory", "packages/modules/src/catalog/migrations/0001_catalog_inventory.sql"],
  ["0002_orders", "packages/modules/src/orders/migrations/0002_orders.sql"],
  ["0003_payments", "packages/modules/src/payments/migrations/0003_payments.sql"],
  ["0004_delivery", "packages/modules/src/delivery/migrations/0004_delivery.sql"],
  ["0005_auth", "packages/platform/src/db/migrations/0005_auth.sql"],
  ["0006_customer", "packages/modules/src/customer/migrations/0006_customer.sql"],
  ["0007_orders_checkout", "packages/modules/src/orders/migrations/0007_orders_checkout.sql"],
  ["0008_product_images", "packages/modules/src/catalog/migrations/0008_product_images.sql"],
  ["0009_categories", "packages/modules/src/catalog/migrations/0009_categories.sql"],
  ["0010_adoptions", "packages/modules/src/adoptions/migrations/0010_adoptions.sql"],
];

const entries = files
  .map(([name, path]) => `  { name: ${JSON.stringify(name)}, sql: ${JSON.stringify(readFileSync(path, "utf8"))} },`)
  .join("\n");

const out = `// GENERADO por scripts/gen-migrations.mjs — NO editar a mano.
// SQL de las migraciones embebido para correrlas desde /api/admin/migrate en Vercel.
export const MIGRATIONS: { name: string; sql: string }[] = [
${entries}
];
`;

writeFileSync("apps/web/lib/migrations.generated.ts", out);
console.log("apps/web/lib/migrations.generated.ts generado con", files.length, "migraciones");
