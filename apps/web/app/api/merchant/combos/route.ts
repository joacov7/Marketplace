import { NextResponse } from "next/server";
import { createCombo, listCombosAdmin } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Lista los combos del comercio (con sus ítems). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const url = new URL(req.url);
  const merchantId = url.searchParams.get("merchantId");
  if (!merchantId) return NextResponse.json({ error: "missing_merchantId" }, { status: 400 });

  const combos = await db().withTenant(tenant.tenantId, (tx) => listCombosAdmin(tx, merchantId));
  return NextResponse.json({ combos });
}

/** Crea un combo vacío (después se le agregan ítems por PATCH). */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

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
