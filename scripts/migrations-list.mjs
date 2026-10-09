// Fuente de verdad ÚNICA del orden de migraciones. La usan:
//  - gen-migrations.mjs (embebe el SQL para el endpoint del panel)
//  - migrate-prod.mjs (las aplica en el deploy, con tracking + lock)
// Al agregar una migración nueva, sumala acá y listo.
export const MIGRATION_FILES = [
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
  ["0011_food_nutrition", "packages/modules/src/catalog/migrations/0011_food_nutrition.sql"],
  ["0012_pets", "packages/modules/src/pets/migrations/0012_pets.sql"],
  ["0013_customers_channel", "packages/modules/src/customer/migrations/0013_customers_channel.sql"],
  ["0014_zone_eta", "packages/modules/src/delivery/migrations/0014_zone_eta.sql"],
  ["0015_variant_list_price", "packages/modules/src/catalog/migrations/0015_variant_list_price.sql"],
  ["0016_subscriptions", "packages/modules/src/subscriptions/migrations/0016_subscriptions.sql"],
  ["0017_images", "packages/modules/src/catalog/migrations/0017_images.sql"],
  ["0018_category_hidden", "packages/modules/src/catalog/migrations/0018_category_hidden.sql"],
  ["0019_combos", "packages/modules/src/catalog/migrations/0019_combos.sql"],
  ["0020_mercadopago", "packages/modules/src/payments/migrations/0020_mercadopago.sql"],
  ["0021_auth_failures", "packages/platform/src/db/migrations/0021_auth_failures.sql"],
];
