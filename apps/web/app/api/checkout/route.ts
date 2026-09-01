import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { createOrder } from "@commerce/modules/orders";
import { createPaymentIntent, FakePaymentProvider } from "@commerce/modules/payments";
import { quoteDelivery } from "@commerce/modules/delivery";
import { addAddress } from "@commerce/modules/customer";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// V1: proveedor "fake" (pago a la operación propia). Se reemplaza por Mercado Pago sin
// tocar este handler (Payment Orchestrator).
const provider = new FakePaymentProvider();

interface Addr { street?: string; city?: string; zone?: string; notes?: string; label?: string }
interface CheckoutBody { items: Array<{ variantId: string; qty: number }>; address?: Addr; deliveryWindow?: string }

export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400 });

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "empty_cart" }, { status: 400 });
  }

  // Precios actuales + merchant + cotización de envío (una lectura con contexto de tenant).
  const priced = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return null;
    const items = [];
    let gmv = 0n;
    for (const it of body.items) {
      const v = await getVariantWithPrice(tx, it.variantId);
      if (!v || !v.price) return null;
      items.push({ variantId: it.variantId, qty: it.qty, unitPriceMinor: v.price.amountMinor });
      gmv += v.price.amountMinor * BigInt(it.qty);
    }
    const dq = await quoteDelivery(tx, { tenantId: tenant.tenantId, orderTotalMinor: gmv });
    return { merchantId: merchants[0].id, items, gmv, deliveryChargeMinor: dq.customerChargeMinor };
  });
  if (!priced) return NextResponse.json({ error: "invalid_items_or_no_merchant" }, { status: 400 });

  const session = readSession();

  const order = await createOrder(db(), {
    tenantId: tenant.tenantId,
    ...(session?.userId ? { customerId: session.userId } : {}),
    ...(body.address ? { shippingAddress: body.address as Record<string, unknown> } : {}),
    ...(body.deliveryWindow ? { deliveryWindow: body.deliveryWindow } : {}),
    deliveryChargeMinor: priced.deliveryChargeMinor,
    sellers: [{ merchantId: priced.merchantId, items: priced.items }],
  });
  if (!order.ok) return NextResponse.json({ error: order.error }, { status: 409 });

  // Guardar la dirección en la libreta del cliente logueado (best-effort).
  if (session?.userId && body.address?.street) {
    await db()
      .withTenant(tenant.tenantId, (tx) =>
        addAddress(tx, {
          tenantId: tenant.tenantId,
          customerId: session.userId,
          street: body.address!.street!,
          ...(body.address!.city ? { city: body.address!.city } : {}),
          ...(body.address!.zone ? { zone: body.address!.zone } : {}),
          ...(body.address!.notes ? { notes: body.address!.notes } : {}),
          ...(body.address!.label ? { label: body.address!.label } : {}),
        }),
      )
      .catch(() => {});
  }

  const intent = await createPaymentIntent(db(), provider, {
    tenantId: tenant.tenantId,
    orderId: order.value.orderId,
    idempotencyKey,
  });
  if (!intent.ok) return NextResponse.json({ error: intent.error }, { status: 500 });

  return NextResponse.json(
    {
      orderId: order.value.orderId,
      gmvMinor: priced.gmv.toString(),
      deliveryChargeMinor: priced.deliveryChargeMinor.toString(),
      totalMinor: (priced.gmv + priced.deliveryChargeMinor).toString(),
      providerRef: intent.value.providerRef,
    },
    { status: 201 },
  );
}
