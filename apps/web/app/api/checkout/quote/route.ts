import { NextResponse } from "next/server";
import { checkDeliveryRadius, applyMinOrder } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { parseCart, loadPricingConfig, priceCart, CART_ERROR_MESSAGE } from "@/lib/cart";

export const dynamic = "force-dynamic";

interface QuoteBody {
  items?: Array<{ variantId: string; qty: number }>;
  delivery?: "estandar" | "auxilio";
  payment?: "transferencia" | "mercadopago" | "efectivo" | "pos";
  zone?: string;
  lat?: number;
  lng?: number;
}

/**
 * Cotiza el carrito con los valores de negocio del Configuration Engine (nunca hardcodeados):
 * subtotal (GMV) + envío (estándar gratis sobre umbral, o Envío de Auxilio) + total. Mismo
 * cálculo que /api/checkout (lib/cart.ts), así lo cotizado es lo que se cobra. Todo en centavos.
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
  const cart = parseCart(body.items);
  if (!cart.ok) return NextResponse.json({ error: cart.error, message: CART_ERROR_MESSAGE[cart.error] }, { status: 400 });

  const pricing = await loadPricingConfig(tenant.tenantId);
  const delivery = body.delivery === "auxilio" ? "auxilio" : "estandar";
  const priced = await db().withTenant(tenant.tenantId, (tx) => priceCart(tx, pricing, { items: cart.items, delivery, zone: body.zone }));
  if (!priced) return NextResponse.json({ error: "invalid_items" }, { status: 400 });
  const gmv = priced.gmv;
  const threshold = pricing.freeOverMinor;
  const minOrder = applyMinOrder({ hasFood: priced.hasFood, gmvMinor: gmv, config: pricing.minOrder });

  const shipping = priced.deliveryChargeMinor;
  const total = gmv + shipping;

  // Radio de reparto: evalúa la ubicación (si se compartió) contra la geocerca del comercio.
  const radius = await checkDeliveryRadius(db(), { tenantId: tenant.tenantId, lat: body.lat, lng: body.lng });

  return NextResponse.json({
    gmvMinor: gmv.toString(),
    deliveryChargeMinor: shipping.toString(),
    totalMinor: total.toString(),
    freeShippingThresholdMinor: threshold.toString(),
    missingForFreeMinor: (gmv >= threshold ? 0n : threshold - gmv).toString(),
    // Mínimo de envío por segmento (con alimento vs almacén puro).
    hasFood: minOrder.hasFood,
    minOrderMinor: minOrder.minMinor.toString(),
    meetsMinimum: minOrder.meets,
    missingForMinimumMinor: minOrder.missingMinor.toString(),
    zoneEtaMinutes: priced.zoneEtaMinutes,
    radius: {
      enabled: radius.enabled,
      radiusKm: radius.radiusKm,
      distanceKm: radius.distanceKm,
      withinRadius: radius.withinRadius,
    },
  });
}
