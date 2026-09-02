import { NextResponse } from "next/server";
import { createCategory, listCategories } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Lista las categorías de un comercio. */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const merchantId = url.searchParams.get("merchantId");
  if (!merchantId) return NextResponse.json({ error: "missing_merchantId" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listCategories(tx, merchantId));
  return NextResponse.json({ categories: rows });
}

/** Crea una categoría en un comercio. */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { merchantId?: string; name?: string; imageUrl?: string; position?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.merchantId || !body.name?.trim()) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const imageUrl = safeUrl(body.imageUrl);
  const result = await db().withTenant(tenant.tenantId, (tx) =>
    createCategory(tx, {
      tenantId: tenant.tenantId,
      merchantId: body.merchantId!,
      name: body.name!.trim(),
      ...(imageUrl ? { imageUrl } : {}),
      ...(body.position !== undefined ? { position: Number(body.position) } : {}),
    }),
  );
  return NextResponse.json(result, { status: 201 });
}
