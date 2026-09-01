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

  const applied: string[] = [];
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
    if (!res.ok) return NextResponse.json({ error: res.error, key }, { status: 400 });
    applied.push(key);
  }

  return NextResponse.json({ ok: true, applied });
}
