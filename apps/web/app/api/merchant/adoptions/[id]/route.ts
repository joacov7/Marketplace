import { NextResponse } from "next/server";
import { updateAdoption, deleteAdoption, type Species } from "@commerce/modules/adoptions";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

const SPECIES: Species[] = ["perro", "gato", "otro"];

/** Actualiza una publicación (datos o estado available/adopted). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { name?: string; species?: string; age?: string; description?: string; imageUrl?: string; contactWhatsapp?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  await db().withTenant(tenant.tenantId, (tx) =>
    updateAdoption(tx, {
      id: params.id,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.species !== undefined && (SPECIES as string[]).includes(body.species) ? { species: body.species as Species } : {}),
      ...(body.age !== undefined ? { age: body.age.trim() || null } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: safeUrl(body.imageUrl) || null } : {}),
      ...(body.contactWhatsapp !== undefined ? { contactWhatsapp: body.contactWhatsapp.replace(/[^0-9]/g, "") || null } : {}),
      ...(body.status === "available" || body.status === "adopted" ? { status: body.status } : {}),
    }),
  );
  return NextResponse.json({ ok: true });
}

/** Elimina una publicación. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  await db().withTenant(tenant.tenantId, (tx) => deleteAdoption(tx, params.id));
  return NextResponse.json({ ok: true });
}
