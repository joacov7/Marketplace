import { NextResponse } from "next/server";
import { createTenant, PET_SHOP_TEMPLATE } from "@commerce/platform";
import { createProduct, addVariant, setPrice, createCategory, listCategories } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db, rawExec } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";
import { MIGRATIONS } from "@/lib/migrations.generated";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Categorías estándar del vertical pet shop (las de la vitrina). Orden = position.
const DEMO_CATEGORIES = [
  "Alimentos para Perros",
  "Alimentos para Gatos",
  "Snacks y Golosinas",
  "Piedras Sanitarias",
  "Higiene y Cuidado",
  "Antiparasitarios y Salud",
  "Accesorios y Juguetes",
  "Transporte",
  "Comederos y Bebederos",
  "Ofertas",
];

// Catálogo demo categorizado, con talles/pesos (variantes) y descripción. Precios en centavos.
const DEMO_PRODUCTS = [
  { slug: "proplan", name: "Pro Plan Adulto", category: "Alimentos para Perros", desc: "Alimento completo y balanceado para perros adultos de razas medianas y grandes. Con OPTIHEALTH para una digestión saludable.",
    kcal: 3800, protein: 26, sizes: [{ v: "3 kg", price: 1_890_000n }, { v: "7.5 kg", price: 4_190_000n }, { v: "15 kg", price: 7_290_000n }] },
  { slug: "dogo", name: "Dogo Premium", category: "Alimentos para Perros", desc: "Alimento premium argentino para perros adultos. Buena relación precio-calidad para el día a día.",
    kcal: 3500, protein: 23, sizes: [{ v: "8 kg", price: 2_590_000n }, { v: "15 kg", price: 4_580_000n }, { v: "22 kg", price: 6_390_000n }] },
  { slug: "raza", name: "Raza Adultos", category: "Alimentos para Perros", desc: "Alimento estándar para perros adultos de todas las razas. Disponible también fraccionado por kilo.",
    kcal: 3300, protein: 21, sizes: [{ v: "10 kg", price: 2_690_000n }, { v: "15 kg", price: 3_850_000n }, { v: "20 kg", price: 4_990_000n }] },
  { slug: "pedigree", name: "Pedigree Vital", category: "Alimentos para Perros", desc: "Alimento con Vital Protection para el cuidado diario de la piel, el pelaje y las defensas.",
    kcal: 3400, protein: 22, sizes: [{ v: "8 kg", price: 2_290_000n }, { v: "15 kg", price: 3_990_000n }, { v: "21 kg", price: 5_290_000n }] },
  { slug: "whiskas", name: "Whiskas Adulto", category: "Alimentos para Gatos", desc: "Alimento balanceado para gatos adultos, con nutrientes esenciales y sabor a carne.",
    kcal: 3900, protein: 30, sizes: [{ v: "1.5 kg", price: 690_000n }, { v: "3 kg", price: 1_290_000n }, { v: "10 kg", price: 3_450_000n }] },
  { slug: "piedras", name: "Piedras Sanitarias", category: "Piedras Sanitarias", desc: "Piedras aglomerantes de alto poder absorbente. Controlan el olor y facilitan la limpieza diaria.",
    sizes: [{ v: "4 kg", price: 890_000n }, { v: "10 kg", price: 1_850_000n }] },
  { slug: "snack-dental", name: "Snack Dental", category: "Snacks y Golosinas", desc: "Snack dental de textura especial que ayuda a reducir la formación de sarro hasta un 80%.",
    sizes: [{ v: "7 u.", price: 490_000n }, { v: "14 u.", price: 890_000n }, { v: "28 u.", price: 1_590_000n }] },
  { slug: "shampoo", name: "Shampoo Hipoalergénico", category: "Higiene y Cuidado", desc: "Shampoo suave de pH neutro para pieles sensibles. No irrita los ojos y deja el pelaje brillante.",
    sizes: [{ v: "250 ml", price: 590_000n }, { v: "500 ml", price: 970_000n }] },
  { slug: "collar-correa", name: "Collar + Correa", category: "Accesorios y Juguetes", desc: "Set de collar y correa de cuero reforzado con herrajes metálicos. Resistente al uso diario.",
    sizes: [{ v: "S", price: 990_000n }, { v: "M", price: 1_240_000n }, { v: "L", price: 1_490_000n }] },
  { slug: "antiparasitario", name: "Antiparasitario Externo", category: "Antiparasitarios y Salud", desc: "Pipeta de acción prolongada contra pulgas y garrapatas. Protección por 30 días.",
    sizes: [{ v: "2-10 kg", price: 1_290_000n }, { v: "10-20 kg", price: 1_560_000n }, { v: "20-40 kg", price: 1_890_000n }] },
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
    // Backfill Eslabón 1 (corre con contexto de tenant, así que RLS lo permite):
    //  - ficha de cliente por cada usuario registrado (id = user id), para que sus mascotas/
    //    pedidos ya existentes queden bajo una ficha consultable.
    //  - pedidos ya confirmados/pagados por webhook antes de esta migración → payment_status
    //    'pagado' (los nuevos pagos online lo setean solos; el pago al recibir queda pendiente).
    await tx.query(
      `insert into customers (id, tenant_id, user_id, name)
         select id, tenant_id, id, email from users
        on conflict (id) do nothing`,
    );
    await tx.query(
      `update orders set payment_status = 'pagado'
        where status in ('confirmed','completed','partially_refunded','refunded') and payment_status = 'pendiente'`,
    );

    let m = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    let merchantId = m[0]?.id;
    if (!merchantId) {
      const r = await tx.query<{ id: string }>(
        "insert into merchants (tenant_id, slug, name) values ($1,'petshop','Pet Shop') returning id",
        [tenantId],
      );
      merchantId = r[0]!.id;
    }

    // Categorías estándar (idempotente por nombre).
    const existingCats = await listCategories(tx, merchantId);
    const catId = new Map(existingCats.map((c) => [c.name, c.id]));
    for (let i = 0; i < DEMO_CATEGORIES.length; i++) {
      const name = DEMO_CATEGORIES[i]!;
      if (!catId.has(name)) {
        const { categoryId } = await createCategory(tx, { tenantId, merchantId, name, position: i });
        catId.set(name, categoryId);
      }
    }

    for (const p of DEMO_PRODUCTS) {
      const categoryId = catId.get(p.category) ?? null;
      const ex = await tx.query<{ id: string; category_id: string | null }>(
        "select id, category_id from products where merchant_id = $1 and slug = $2",
        [merchantId, p.slug],
      );
      const kcalP = (p as { kcal?: number }).kcal ?? null;
      const proteinP = (p as { protein?: number }).protein ?? null;
      if (ex[0]) {
        // Backfill de lo que falte: categoría, descripción y nutrición (sin pisar ediciones).
        if (!ex[0].category_id && categoryId) {
          await tx.query("update products set category_id = $2 where id = $1", [ex[0].id, categoryId]);
        }
        await tx.query("update products set description = coalesce(description,$2) where id = $1", [ex[0].id, p.desc]);
        if (kcalP !== null) {
          await tx.query("update products set kcal_per_kg = coalesce(kcal_per_kg,$2), protein_pct = coalesce(protein_pct,$3) where id = $1", [ex[0].id, kcalP, proteinP]);
        }
        // Peso neto por variante (match por el label del talle), solo si falta.
        for (const s of p.sizes) {
          const m = /([\d.]+)\s*kg/i.exec(s.v);
          if (m) {
            await tx.query(
              "update variants set net_weight_kg = coalesce(net_weight_kg,$3) where product_id = $1 and name = $2",
              [ex[0].id, s.v, Number(m[1])],
            );
          }
        }
        continue;
      }
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: p.slug, name: p.name, description: p.desc, ...(categoryId ? { categoryId } : {}) });
      if (kcalP !== null) {
        await tx.query("update products set kcal_per_kg = $2, protein_pct = $3 where id = $1", [productId, kcalP, proteinP]);
      }
      let idx = 0;
      for (const s of p.sizes) {
        const { variantId } = await addVariant(tx, { tenantId, productId, sku: `${p.slug}-${idx++}`, name: s.v });
        await setPrice(tx, { tenantId, variantId, amountMinor: s.price });
        await setStock(tx, { tenantId, variantId, available: 25 });
        // Peso neto de la bolsa (para la calculadora): del label "15 kg" → 15.
        const m = /([\d.]+)\s*kg/i.exec(s.v);
        if (m) await tx.query("update variants set net_weight_kg = $2 where id = $1", [variantId, Number(m[1])]);
      }
      created.push(p.name);
    }
  });
  return { tenantId, slug, categories: DEMO_CATEGORIES.length, productsCreated: created };
}
