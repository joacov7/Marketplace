import { NextResponse } from "next/server";
import { createTenant, PET_SHOP_TEMPLATE } from "@commerce/platform";
import { createProduct, addVariant, setPrice } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db, rawExec } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";
import { MIGRATIONS } from "@/lib/migrations.generated";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEMO_PRODUCTS = [
  { slug: "alimento-perro", name: "Alimento Perro Adulto", sku: "AP-15KG", vname: "15kg", price: 3_000_000n, stock: 20 },
  { slug: "arena-gato", name: "Arena Gato Aglomerante", sku: "AG-10L", vname: "10L", price: 800_000n, stock: 15 },
  { slug: "juguete-mordedor", name: "Juguete Mordedor", sku: "JM-01", vname: "Único", price: 450_000n, stock: 30 },
];

/**
 * Bootstrap de la base (solo super admin de plataforma): corre las migraciones y, con
 * `?seed=<slug>`, siembra un tenant Pet Shop de demo con un comercio y productos. Todo es
 * idempotente (las migraciones tienen guards; el seed no duplica). Pensado para hacer el
 * setup sin entorno local:
 *
 *   curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" \
 *     "https://<deploy>/api/admin/migrate?seed=gualeguay"
 */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const applied: string[] = [];
  try {
    for (const m of MIGRATIONS) {
      await rawExec(m.sql);
      applied.push(m.name);
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, step: "migrate", applied, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const seedSlug = new URL(req.url).searchParams.get("seed");
  let seed: unknown = null;
  if (seedSlug) {
    try {
      seed = await seedTenant(seedSlug);
    } catch (e) {
      return NextResponse.json(
        { ok: false, step: "seed", applied, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, applied, seed });
}

async function seedTenant(slug: string) {
  const existing = await db().query<{ id: string }>("select id from tenants where slug = $1", [slug]);
  let tenantId: string;
  if (existing[0]) {
    tenantId = existing[0].id;
  } else {
    const res = await createTenant(db(), {
      slug,
      name: "Pet Shop " + slug,
      template: PET_SHOP_TEMPLATE,
      region: { slug, name: slug },
      actor: "bootstrap",
    });
    if (!res.ok) throw new Error(res.error);
    tenantId = res.value.tenantId;
  }

  const created: string[] = [];
  await db().withTenant(tenantId, async (tx) => {
    let m = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    let merchantId = m[0]?.id;
    if (!merchantId) {
      const r = await tx.query<{ id: string }>(
        "insert into merchants (tenant_id, slug, name) values ($1,'petshop','Pet Shop') returning id",
        [tenantId],
      );
      merchantId = r[0]!.id;
    }
    for (const p of DEMO_PRODUCTS) {
      const ex = await tx.query("select id from products where merchant_id = $1 and slug = $2", [merchantId, p.slug]);
      if (ex[0]) continue;
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: p.slug, name: p.name });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: p.sku, name: p.vname });
      await setPrice(tx, { tenantId, variantId, amountMinor: p.price });
      await setStock(tx, { tenantId, variantId, available: p.stock });
      created.push(p.name);
    }
  });
  return { tenantId, slug, productsCreated: created };
}
