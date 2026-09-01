import { NextResponse } from "next/server";
import { setPrice } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Actualiza precio y/o stock de una variante. */
export async function PATCH(req: Request, { params }: { params: { variantId: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { priceMinor?: string | number; stock?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  await db().withTenant(tenant.tenantId, async (tx) => {
    if (body.priceMinor !== undefined) {
      await setPrice(tx, { tenantId: tenant.tenantId, variantId: params.variantId, amountMinor: BigInt(body.priceMinor!) });
    }
    if (body.stock !== undefined) {
      await setStock(tx, { tenantId: tenant.tenantId, variantId: params.variantId, available: Number(body.stock) });
    }
  });
  return NextResponse.json({ ok: true });
}
