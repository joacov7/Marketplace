import { NextResponse } from "next/server";
import { resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Claves de tema que este editor administra (deben existir en el registry de config). */
const THEME_KEYS = [
  "branding.displayName",
  "branding.primaryColor",
  "branding.secondaryColor",
  "branding.logoUrl",
  "branding.bannerText",
  "branding.bannerImageUrl",
  "branding.layout",
  "branding.font",
  "branding.buttonShape",
  "contact.whatsapp",
  "contact.whatsappMessage",
  "storefront.promoText",
  "storefront.heroImageUrl",
  "storefront.adoptionsBannerImageUrl",
  "storefront.heroTitle",
  "storefront.heroHighlight",
  "storefront.heroSubtitle",
  "storefront.footerBlurb",
  "storefront.perks",
  "storefront.benefits",
  "storefront.adoptionsTitle",
  "features.adoptions",
  "features.foodCalculator",
  "features.foodComparator",
  "features.quickReorder",
  "features.aiAssistant",
  "features.subscriptions",
] as const;
type ThemeKey = (typeof THEME_KEYS)[number];

/** Devuelve el tema efectivo del tenant (resolución platform→tenant). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const entries = await Promise.all(
    THEME_KEYS.map(async (k) => [k, (await resolveConfigValue<unknown>(db(), k, { tenantId: tenant.tenantId })).value] as const),
  );
  return NextResponse.json({ theme: Object.fromEntries(entries) });
}

/** Escribe overrides de tema a nivel tenant. Solo las claves conocidas; valida por schema. */
export async function PATCH(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: Partial<Record<ThemeKey, unknown>>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Aplica cada clave de forma independiente: que un campo inválido (p. ej. un texto demasiado
  // largo) NO impida guardar el resto. Se informa qué claves fallaron para poder corregirlas.
  const applied: string[] = [];
  const failed: { key: string; error: string }[] = [];
  for (const key of THEME_KEYS) {
    if (!(key in body)) continue;
    const res = await setConfigValue(db(), {
      key,
      scopeType: "tenant",
      scopeId: tenant.tenantId,
      value: body[key],
      actor: "merchant-admin",
      reason: "theme-editor",
    });
    if (!res.ok) { failed.push({ key, error: res.error }); continue; }
    applied.push(key);
  }

  // Solo es un error duro si NO se pudo guardar nada.
  if (applied.length === 0 && failed.length > 0) {
    return NextResponse.json({ error: failed[0]!.error, key: failed[0]!.key, failed }, { status: 400 });
  }
  return NextResponse.json({ ok: true, applied, failed });
}
