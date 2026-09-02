import { NextResponse } from "next/server";
import { listAdoptions } from "@commerce/modules/adoptions";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Publicaciones de adopción disponibles (vista pública de la tienda). */
export async function GET(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listAdoptions(tx));
  return NextResponse.json({ adoptions: rows });
}
