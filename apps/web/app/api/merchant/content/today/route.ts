import { NextResponse } from "next/server";
import { resolveConfigValue } from "@commerce/platform";
import { generatePost, postToText, CONTENT_THEMES, THEME_LABEL } from "@commerce/modules/content";
import type { ContentTheme, ContentTemplate, FeaturedProduct } from "@commerce/modules/content";
import { searchProducts } from "@commerce/modules/agent";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

function pesos(minor: bigint | null, currency: string | null): string | undefined {
  if (minor === null) return undefined;
  const n = Number(minor) / 100;
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: currency ?? "ARS", maximumFractionDigits: 0 });
  } catch {
    return `$${Math.round(n).toLocaleString("es-AR")}`;
  }
}

/** Etiqueta de producto para marketing: producto + variante si aporta (no "Único"). */
function label(productName: string, variantName: string): string {
  const v = variantName?.trim();
  return v && v !== "Único" ? `${productName} ${v}` : productName;
}

function placaUrl(base: string, params: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `${base}?${q.toString()}`;
}

/**
 * Estudio de Contenido — post del día. Compone con DATOS REALES del tenant: calendario de temas,
 * plantillas y hashtags de config (editables por comercio, nada hardcodeado), y un producto en
 * stock del catálogo para los temas que lo piden. Devuelve el texto listo para copiar y la URL de
 * la placa ya armada. La publicación a redes es manual (por ahora): el comercio aprueba y sube.
 */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const tenantId = tenant.tenantId;

  const enabled = (await resolveConfigValue<boolean>(db(), "features.contentStudio", { tenantId })).value;

  const dateParam = url.searchParams.get("date");
  const date = dateParam ? new Date(`${dateParam}T12:00:00Z`) : new Date();
  const themeParam = url.searchParams.get("theme");
  const theme: ContentTheme | undefined = themeParam && (CONTENT_THEMES as string[]).includes(themeParam) ? (themeParam as ContentTheme) : undefined;
  const variantParam = url.searchParams.get("variant");
  const variant = variantParam !== null && Number.isFinite(Number(variantParam)) ? Number(variantParam) : undefined;

  const [store, pc, sc, handleCfg, phone, schedule, templates, hashtags, discount] = await Promise.all([
    resolveConfigValue<string>(db(), "branding.displayName", { tenantId }),
    resolveConfigValue<string>(db(), "branding.primaryColor", { tenantId }),
    resolveConfigValue<string>(db(), "branding.secondaryColor", { tenantId }),
    resolveConfigValue<string>(db(), "content.handle", { tenantId }),
    resolveConfigValue<string>(db(), "contact.whatsapp", { tenantId }),
    resolveConfigValue<Partial<Record<string, ContentTheme>>>(db(), "content.themeSchedule", { tenantId }),
    resolveConfigValue<Partial<Record<ContentTheme, ContentTemplate[]>>>(db(), "content.templates", { tenantId }),
    resolveConfigValue<string[]>(db(), "content.hashtags", { tenantId }),
    resolveConfigValue<number>(db(), "subscriptions.discountPercent", { tenantId }),
  ]);

  const hits = await db().withTenant(tenantId, (tx) => searchProducts(tx, { query: "", limit: 40, inStockOnly: true }));
  const products: FeaturedProduct[] = hits.map((h) => ({
    name: label(h.productName, h.name),
    ...(pesos(h.priceMinor, h.currency) ? { priceLabel: pesos(h.priceMinor, h.currency)! } : {}),
    category: h.categoryName ?? null,
  }));

  const brand = {
    store: store.value || tenant.name,
    primaryColor: pc.value || "#0a7d4b",
    secondaryColor: sc.value || "#0b3d2e",
    ...(handleCfg.value ? { handle: handleCfg.value } : {}),
    ...(phone.value ? { phone: phone.value } : {}),
  };

  const post = generatePost({
    date,
    ...(theme ? { theme } : {}),
    ...(variant !== undefined ? { variant } : {}),
    schedule: schedule.value ?? {},
    templates: templates.value ?? {},
    hashtags: hashtags.value ?? [],
    brand,
    products,
    subscriptionDiscountPercent: discount.value ?? 0,
  });

  const placa = placaUrl("/api/merchant/content/placa", {
    title: post.title,
    body: post.body,
    tag: post.themeLabel,
    store: brand.store,
    handle: brand.handle ?? "",
    price: post.product?.priceLabel ?? "",
    pc: brand.primaryColor,
    sc: brand.secondaryColor,
  });

  return NextResponse.json({
    enabled,
    date: date.toISOString().slice(0, 10),
    weekday: date.getUTCDay(),
    post,
    text: postToText(post),
    placaUrl: placa,
    themes: CONTENT_THEMES.map((t) => ({ value: t, label: THEME_LABEL[t] })),
    productCount: products.length,
  });
}
