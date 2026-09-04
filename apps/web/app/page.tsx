import { resolveConfigValue } from "@commerce/platform";
import { listCatalog, listCategories } from "@commerce/modules/catalog";
import { listAdoptions, type Adoption } from "@commerce/modules/adoptions";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { safeUrl } from "@/lib/sanitize";
import Storefront, { type StoreProduct, type StoreConfig, type StoreCategory, type StoreContent } from "./storefront";

export const dynamic = "force-dynamic"; // depende del tenant resuelto por request

/** Normaliza un color de config a un hex CSS válido (con fallback). Defensivo. */
function cssColor(v: string | undefined, fallback = "#2E7D32"): string {
  const s = (v ?? "").replace(/^"+|"+$/g, "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}
function cleanText(v: string | undefined, fallback: string): string {
  const s = (v ?? "").replace(/^"+|"+$/g, "").trim();
  return s.length > 0 ? s : fallback;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>{children}</main>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div style={{ marginTop: "8vh", textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        <div style={{ color: "#666", lineHeight: 1.6 }}>{children}</div>
      </div>
    </Shell>
  );
}

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export default async function Home({ searchParams }: { searchParams: { tenant?: string } }) {
  let tenant;
  try {
    tenant = await resolveTenant(searchParams?.tenant ?? null);
  } catch (e) {
    console.error("[home] error resolviendo tenant/DB:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>
          No se pudo conectar a la base o leer los datos. Verificá que <code>DATABASE_URL</code> esté seteada en Vercel y
          que hayas corrido las migraciones (<code>/api/admin/migrate</code>). Probá <code>/api/health</code>.
        </p>
      </Notice>
    );
  }

  if (!tenant) {
    return (
      <Notice title="Commerce OS">
        <p>
          No se resolvió ningún comercio para este dominio. Accedé por el subdominio del tenant
          (p. ej. <code>gualeguay.tudominio.com</code>) o agregá <code>?tenant=gualeguay</code> a la URL.
        </p>
      </Notice>
    );
  }

  const chain = { tenantId: tenant.tenantId };
  const cfg = <T,>(key: string) => resolveConfigValue<T>(db(), key, chain).then((r) => r.value);

  try {
    const [
      primary, displayName, logoUrl, whatsapp, whatsappMessage,
      thresholdMinor, standardCostMinor, auxilioCostMinor, transferPct, auxilioEnabled,
      featuredCount, listColumns,
      promoText, heroTitle, heroHighlight, heroSubtitle, footerBlurb, perks, benefits,
      adoptionsEnabled, adoptionsTitle,
      foodCalculator, foodComparator, quickReorder, nutritionFactors,
      heroImageUrl, adoptionsBannerImageUrl,
      catalog0,
    ] = await Promise.all([
      cfg<string>("branding.primaryColor"),
      cfg<string>("branding.displayName"),
      cfg<string>("branding.logoUrl"),
      cfg<string>("contact.whatsapp"),
      cfg<string>("contact.whatsappMessage"),
      cfg<number>("delivery.freeOverOrderTotalMinor"),
      cfg<number>("delivery.customerChargeMinor"),
      cfg<number>("delivery.auxilioCostMinor"),
      cfg<number>("payments.transferDiscountPercent"),
      cfg<boolean>("features.auxilioDelivery"),
      cfg<number>("storefront.featuredCount"),
      cfg<number>("storefront.listColumns"),
      cfg<string>("storefront.promoText"),
      cfg<string>("storefront.heroTitle"),
      cfg<string>("storefront.heroHighlight"),
      cfg<string>("storefront.heroSubtitle"),
      cfg<string>("storefront.footerBlurb"),
      cfg<Array<{ t: string; s: string }>>("storefront.perks"),
      cfg<Array<{ t: string; s: string }>>("storefront.benefits"),
      cfg<boolean>("features.adoptions"),
      cfg<string>("storefront.adoptionsTitle"),
      cfg<boolean>("features.foodCalculator"),
      cfg<boolean>("features.foodComparator"),
      cfg<boolean>("features.quickReorder"),
      cfg<Record<string, number>>("nutrition.factors"),
      cfg<string>("storefront.heroImageUrl"),
      cfg<string>("storefront.adoptionsBannerImageUrl"),
      db().withTenant(tenant.tenantId, async (tx) => {
        const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
        const adoptions = await listAdoptions(tx);
        if (!merchants[0]) return { catalog: [], categories: [], adoptions };
        const [catalog, categories] = await Promise.all([listCatalog(tx, merchants[0].id), listCategories(tx, merchants[0].id)]);
        return { catalog, categories, adoptions };
      }),
    ]);
    const { catalog, categories: catRows, adoptions: adoptionRows } = catalog0;

    // Agrupa las variantes por producto: cada producto tiene 1..n talles/pesos con su precio.
    const byProduct = new Map<string, StoreProduct>();
    for (const v of catalog) {
      if (!v.price) continue;
      let p = byProduct.get(v.productId);
      if (!p) {
        p = {
          productId: v.productId,
          name: v.productName ?? v.name,
          category: cleanText(v.categoryName ?? "", ""),
          description: cleanText(v.description ?? "", ""),
          imageUrl: safeUrl(v.imageUrl),
          kcalPerKg: v.kcalPerKg ?? null,
          proteinPct: v.proteinPct ?? null,
          variants: [],
        };
        byProduct.set(v.productId, p);
      }
      p.variants.push({ variantId: v.variantId, size: v.name, priceMinor: v.price.amountMinor.toString(), currency: v.price.currency, netWeightKg: v.netWeightKg ?? null, listPriceMinor: v.listPriceMinor != null ? v.listPriceMinor.toString() : null });
    }
    const products = [...byProduct.values()].filter((p) => p.variants.length > 0);

    const storeCategories: StoreCategory[] = catRows
      .map((c) => ({ name: c.name, position: c.position, imageUrl: safeUrl(c.imageUrl ?? "") }))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

    const cleanPairs = (v: unknown): Array<{ t: string; s: string }> =>
      Array.isArray(v) ? v.map((x) => ({ t: cleanText((x as { t?: string }).t, ""), s: cleanText((x as { s?: string }).s, "") })).filter((x) => x.t) : [];

    const adoptions = (adoptionsEnabled !== false ? adoptionRows : []).map((a: Adoption) => ({
      id: a.id,
      name: a.name,
      species: a.species,
      age: cleanText(a.age ?? "", ""),
      description: cleanText(a.description ?? "", ""),
      imageUrl: safeUrl(a.imageUrl ?? ""),
      contactWhatsapp: (a.contactWhatsapp ?? "").replace(/[^0-9]/g, ""),
    }));

    const content: StoreContent = {
      promoText: cleanText(promoText, ""),
      heroTitle: cleanText(heroTitle, "Todo lo que tu mascota necesita,"),
      heroHighlight: cleanText(heroHighlight, "sin salir de casa"),
      heroSubtitle: cleanText(heroSubtitle, ""),
      footerBlurb: cleanText(footerBlurb, ""),
      perks: cleanPairs(perks),
      benefits: cleanPairs(benefits),
    };

    const config: StoreConfig = {
      freeShippingThresholdMinor: String(num(thresholdMinor, 2500000)),
      standardCostMinor: String(num(standardCostMinor, 150000)),
      auxilioCostMinor: String(num(auxilioCostMinor, 200000)),
      transferDiscountPercent: num(transferPct, 10),
      auxilioEnabled: auxilioEnabled !== false,
      featuredCount: num(featuredCount, 4),
      listColumns: [2, 3, 4].includes(num(listColumns, 3)) ? (num(listColumns, 3) as 2 | 3 | 4) : 3,
      foodCalculator: foodCalculator !== false,
      foodComparator: foodComparator !== false,
      quickReorder: quickReorder !== false,
      nutritionFactors: (nutritionFactors && typeof nutritionFactors === "object" ? nutritionFactors : {}) as Record<string, number>,
    };

    return (
      <Storefront
        tenant={tenant.slug}
        displayName={cleanText(displayName, "Pet Shop")}
        primary={cssColor(primary)}
        logoUrl={safeUrl(logoUrl)}
        whatsapp={(whatsapp ?? "").replace(/[^0-9]/g, "")}
        whatsappMessage={cleanText(whatsappMessage, "¡Hola! Quiero hacer un pedido.")}
        products={products}
        categories={storeCategories}
        content={content}
        config={config}
        adoptions={adoptions}
        adoptionsTitle={cleanText(adoptionsTitle, "Adopciones")}
        heroImageUrl={safeUrl(heroImageUrl)}
        adoptionsBannerImageUrl={safeUrl(adoptionsBannerImageUrl)}
      />
    );
  } catch (e) {
    console.error("[home] error leyendo config/catálogo:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>El comercio se resolvió pero no se pudieron leer sus datos. Puede faltar correr las migraciones o el seed.</p>
      </Notice>
    );
  }
}
