import { NextResponse } from "next/server";
import { createCombo, listCombosAdmin } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Lista los combos del comercio (con sus ítems). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const merchantId = url.searchParams.get("merchantId");
  if (!merchantId) return NextResponse.json({ error: "missing_merchantId" }, { status: 400 });

  const combos = await db().withTenant(tenant.tenantId, (tx) => listCombosAdmin(tx, merchantId));
  return NextResponse.json({ combos });
}

/** Crea un combo vacío (después se le agregan ítems por PATCH). */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { merchantId?: string; name?: string; description?: string; imageUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.merchantId || !body.name?.trim()) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    createCombo(tx, {
      tenantId: tenant.tenantId,
      merchantId: body.merchantId!,
      name: body.name!.trim(),
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      ...(body.imageUrl ? { imageUrl: safeUrl(body.imageUrl) } : {}),
    }),
  );
  return NextResponse.json({ ok: true, comboId: res.comboId }, { status: 201 });
}
