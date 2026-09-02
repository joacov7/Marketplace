import { NextResponse } from "next/server";
import { createAdoption, listAdoptionsAdmin, type Species } from "@commerce/modules/adoptions";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

const SPECIES: Species[] = ["perro", "gato", "otro"];

/** Todas las publicaciones de adopción (panel). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listAdoptionsAdmin(tx));
  return NextResponse.json({ adoptions: rows });
}

/** Publica una mascota en adopción. */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { name?: string; species?: string; age?: string; description?: string; imageUrl?: string; contactWhatsapp?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "missing_name" }, { status: 400 });

  const species = (SPECIES as string[]).includes(body.species ?? "") ? (body.species as Species) : "otro";
  const result = await db().withTenant(tenant.tenantId, (tx) =>
    createAdoption(tx, {
      tenantId: tenant.tenantId,
      name: body.name!.trim(),
      species,
      ...(body.age?.trim() ? { age: body.age.trim() } : {}),
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      ...(safeUrl(body.imageUrl) ? { imageUrl: safeUrl(body.imageUrl) } : {}),
      ...(body.contactWhatsapp ? { contactWhatsapp: body.contactWhatsapp.replace(/[^0-9]/g, "") } : {}),
    }),
  );
  return NextResponse.json(result, { status: 201 });
}
