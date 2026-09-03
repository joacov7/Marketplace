import { NextResponse } from "next/server";
import { resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Lee el PIN de reparto actual del tenant (para mostrarlo/editarlo en el panel). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const pin = (await resolveConfigValue<string>(db(), "ops.deliveryPin", { tenantId: tenant.tenantId })).value;
  return NextResponse.json({ pin: pin ?? "" });
}

/** Define (o borra con "") el PIN de reparto del tenant. */
export async function PATCH(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { pin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const pin = (body.pin ?? "").trim();

  const res = await setConfigValue(db(), {
    key: "ops.deliveryPin",
    scopeType: "tenant",
    scopeId: tenant.tenantId,
    value: pin,
    actor: "merchant-admin",
    reason: "set-delivery-pin",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, pin });
}
