import { NextResponse } from "next/server";
import { updateCombo, setComboItems, deleteCombo } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Actualiza un combo: nombre/descripción/foto/activo/posición y/o su lista de ítems. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { name?: string; description?: string; imageUrl?: string; active?: boolean; position?: number; items?: Array<{ variantId?: string; qty?: number }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  await db().withTenant(tenant.tenantId, async (tx) => {
    await updateCombo(tx, {
      comboId: params.id,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: safeUrl(body.imageUrl) || null } : {}),
      ...(body.active !== undefined ? { active: !!body.active } : {}),
      ...(body.position !== undefined ? { position: Number(body.position) } : {}),
    });
    if (Array.isArray(body.items)) {
      const items = body.items
        .filter((i): i is { variantId: string; qty?: number } => typeof i.variantId === "string" && i.variantId.length > 0)
        .map((i) => ({ variantId: i.variantId, qty: Math.max(1, Math.floor(Number(i.qty) || 1)) }));
      await setComboItems(tx, { tenantId: tenant.tenantId, comboId: params.id, items });
    }
  });
  return NextResponse.json({ ok: true });
}

/** Borra un combo (y sus ítems). Los productos del catálogo no se tocan. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  await db().withTenant(tenant.tenantId, (tx) => deleteCombo(tx, params.id));
  return NextResponse.json({ ok: true });
}
