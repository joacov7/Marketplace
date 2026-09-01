import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { quoteDelivery } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Cotiza el carrito: subtotal (GMV) + envío + total, para mostrar antes de pagar. */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { items?: Array<{ variantId: string; qty: number }> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "empty_cart" }, { status: 400 });
  }

  const result = await db().withTenant(tenant.tenantId, async (tx) => {
    let gmv = 0n;
    for (const it of body.items!) {
      const v = await getVariantWithPrice(tx, it.variantId);
      if (!v || !v.price) return null;
      gmv += v.price.amountMinor * BigInt(it.qty);
    }
    const dq = await quoteDelivery(tx, { tenantId: tenant.tenantId, orderTotalMinor: gmv });
    return { gmv, delivery: dq.customerChargeMinor };
  });
  if (!result) return NextResponse.json({ error: "invalid_items" }, { status: 400 });

  return NextResponse.json({
    gmvMinor: result.gmv.toString(),
    deliveryChargeMinor: result.delivery.toString(),
    totalMinor: (result.gmv + result.delivery).toString(),
  });
}
