import { NextResponse } from "next/server";
import { listCatalog } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const items = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return [];
    const cat = await listCatalog(tx, merchants[0].id);
    return cat.map((v) => ({
      variantId: v.variantId,
      name: v.name,
      sku: v.sku,
      priceMinor: v.price ? v.price.amountMinor.toString() : null,
      currency: v.price?.currency ?? null,
    }));
  });

  return NextResponse.json({ tenant: tenant.slug, items });
}
