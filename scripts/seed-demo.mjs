// Siembra un tenant Pet Shop de demo con un comercio y unos productos, para ver la home
// con datos. Requiere haber corrido `npm run build` (usa los paquetes compilados) y
// `npm run migrate`. Idempotente: no duplica si ya existe.
// Uso: DATABASE_URL=... SEED_TENANT_SLUG=gualeguay node scripts/seed-demo.mjs
import postgres from "postgres";
import { pgDb, createTenant, PET_SHOP_TEMPLATE } from "@commerce/platform";
import { createProduct, addVariant, setPrice } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}
const slug = process.env.SEED_TENANT_SLUG || "gualeguay";

const sql = postgres(url, { max: 1, prepare: false });
const db = pgDb(sql);

const PRODUCTS = [
  { slug: "alimento-perro", name: "Alimento Perro Adulto", sku: "AP-15KG", vname: "15kg", price: 3_000_000n, stock: 20 },
  { slug: "arena-gato", name: "Arena Gato Aglomerante", sku: "AG-10L", vname: "10L", price: 800_000n, stock: 15 },
  { slug: "juguete-mordedor", name: "Juguete Mordedor", sku: "JM-01", vname: "Único", price: 450_000n, stock: 30 },
];

try {
  const existing = await db.query("select id from tenants where slug = $1", [slug]);
  let tenantId;
  if (existing[0]) {
    tenantId = existing[0].id;
    console.log(`Tenant '${slug}' ya existe (${tenantId})`);
  } else {
    const res = await createTenant(db, {
      slug,
      name: "Pet Shop " + slug,
      template: PET_SHOP_TEMPLATE,
      region: { slug, name: slug },
      actor: "seed",
    });
    if (!res.ok) throw new Error(res.error);
    tenantId = res.value.tenantId;
    console.log(`Tenant '${slug}' creado (${tenantId})`);
  }

  await db.withTenant(tenantId, async (tx) => {
    let m = await tx.query("select id from merchants order by created_at limit 1");
    let merchantId = m[0]?.id;
    if (!merchantId) {
      const r = await tx.query(
        "insert into merchants (tenant_id, slug, name) values ($1,'petshop','Pet Shop') returning id",
        [tenantId],
      );
      merchantId = r[0].id;
      console.log("Comercio creado");
    }
    for (const p of PRODUCTS) {
      const ex = await tx.query("select id from products where merchant_id = $1 and slug = $2", [merchantId, p.slug]);
      if (ex[0]) continue;
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: p.slug, name: p.name });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: p.sku, name: p.vname });
      await setPrice(tx, { tenantId, variantId, amountMinor: p.price });
      await setStock(tx, { tenantId, variantId, available: p.stock });
      console.log("  + producto:", p.name);
    }
  });
  console.log(`Seed OK. Probá: curl -H "x-tenant: ${slug}" <tu-deploy>/api/catalog`);
} catch (e) {
  console.error("Error en seed:", e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
