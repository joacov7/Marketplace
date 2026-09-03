import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface QuoteBody {
  items?: Array<{ variantId: string; qty: number }>;
  delivery?: "estandar" | "auxilio";
  payment?: "transferencia" | "mercadopago" | "efectivo" | "pos";
}

/**
 * Cotiza el carrito con los valores de negocio del Configuration Engine (nunca hardcodeados):
 * subtotal (GMV) + envío (estándar gratis sobre umbral, o Envío de Auxilio) + descuento por
 * transferencia + total. Todo en centavos.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: QuoteBody;
  try {
    body = (await req.json()) as QuoteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "empty_cart" }, { status: 400 });
  }

  const chain = { tenantId: tenant.tenantId };
  const [threshold, standardCost, auxilioCost, transferPct] = await Promise.all([
    resolveConfigValue<number>(db(), "delivery.freeOverOrderTotalMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.customerChargeMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.auxilioCostMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "payments.transferDiscountPercent", chain).then((r) => BigInt(r.value)),
  ]);

  const gmv = await db().withTenant(tenant.tenantId, async (tx) => {
    let sum = 0n;
    for (const it of body.items!) {
      const v = await getVariantWithPrice(tx, it.variantId);
      if (!v || !v.price) return null;
      sum += v.price.amountMinor * BigInt(Math.max(1, Math.floor(it.qty)));
    }
    return sum;
  });
  if (gmv === null) return NextResponse.json({ error: "invalid_items" }, { status: 400 });

  const delivery = body.delivery === "auxilio" ? "auxilio" : "estandar";
  const shipping = delivery === "auxilio" ? auxilioCost : gmv >= threshold ? 0n : standardCost;
  const discount = body.payment === "transferencia" ? (gmv * transferPct) / 100n : 0n;
  const total = gmv + shipping - discount;

  return NextResponse.json({
    gmvMinor: gmv.toString(),
    deliveryChargeMinor: shipping.toString(),
    discountMinor: discount.toString(),
    totalMinor: total.toString(),
    freeShippingThresholdMinor: threshold.toString(),
    missingForFreeMinor: (gmv >= threshold ? 0n : threshold - gmv).toString(),
  });
}
