import { NextResponse } from "next/server";
import { resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Claves del radio de reparto (geocerca). Deben existir en el registry de config. */
const RADIUS_KEYS = ["delivery.radiusKm", "delivery.centerLat", "delivery.centerLng"] as const;
type RadiusKey = (typeof RADIUS_KEYS)[number];

/** Config efectiva del radio de reparto del tenant. */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const entries = await Promise.all(
    RADIUS_KEYS.map(async (k) => [k, Number((await resolveConfigValue<number>(db(), k, { tenantId: tenant.tenantId })).value) || 0] as const),
  );
  return NextResponse.json(Object.fromEntries(entries));
}

/** Escribe la config del radio a nivel tenant. Valida por schema del registry. */
export async function PATCH(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: Partial<Record<RadiusKey, unknown>>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const applied: string[] = [];
  for (const key of RADIUS_KEYS) {
    if (!(key in body)) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value)) return NextResponse.json({ error: "invalid_value", key }, { status: 400 });
    const res = await setConfigValue(db(), {
      key,
      scopeType: "tenant",
      scopeId: tenant.tenantId,
      value,
      actor: "merchant-admin",
      reason: "delivery-radius-editor",
    });
    if (!res.ok) return NextResponse.json({ error: res.error, key }, { status: 400 });
    applied.push(key);
  }

  return NextResponse.json({ ok: true, applied });
}
