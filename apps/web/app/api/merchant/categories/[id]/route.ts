import { NextResponse } from "next/server";
import { updateCategory, deleteCategory } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Renombra / actualiza una categoría (nombre, foto, posición). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { name?: string; imageUrl?: string; position?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  await db().withTenant(tenant.tenantId, (tx) =>
    updateCategory(tx, {
      categoryId: params.id,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: safeUrl(body.imageUrl) || null } : {}),
      ...(body.position !== undefined ? { position: Number(body.position) } : {}),
    }),
  );
  return NextResponse.json({ ok: true });
}

/** Borra una categoría; sus productos quedan sin categoría. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  await db().withTenant(tenant.tenantId, (tx) => deleteCategory(tx, params.id));
  return NextResponse.json({ ok: true });
}
