import { NextResponse } from "next/server";
import { resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Claves de la agenda de entrega (turnos, días, corte, franja de auxilio). */
const KEYS = ["delivery.slots", "delivery.days", "delivery.cutoffHour", "delivery.auxilioWindow"] as const;
type ScheduleKey = (typeof KEYS)[number];

export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const entries = await Promise.all(
    KEYS.map(async (k) => [k, (await resolveConfigValue<unknown>(db(), k, { tenantId: tenant.tenantId })).value] as const),
  );
  return NextResponse.json(Object.fromEntries(entries));
}

export async function PATCH(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: Partial<Record<ScheduleKey, unknown>>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const applied: string[] = [];
  for (const key of KEYS) {
    if (!(key in body)) continue;
    const res = await setConfigValue(db(), {
      key,
      scopeType: "tenant",
      scopeId: tenant.tenantId,
      value: body[key],
      actor: "merchant-admin",
      reason: "delivery-schedule-editor",
    });
    if (!res.ok) return NextResponse.json({ error: res.error, key }, { status: 400 });
    applied.push(key);
  }
  return NextResponse.json({ ok: true, applied });
}
