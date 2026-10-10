import { NextResponse } from "next/server";
import { applyMercadoPagoPayment } from "@commerce/modules/payments";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { clientIp } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/abuse";
import { mainMerchantId, mercadoPagoCredentials, mercadoPagoProvider } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verificación al VOLVER de Mercado Pago. MP redirige al seguimiento con `payment_id`; la
 * página llama acá para no depender solo del webhook (que puede demorar o perderse). Es
 * seguro exponerlo: no se cree nada del navegador — se consulta el pago a la API de MP con el
 * token del comercio y solo se aplica si su `external_reference` es ESTE pedido.
 * Idempotente con el webhook (el que llega primero captura; el otro es no-op).
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const limited = await rateLimited(
    [{ key: `mp-sync:ip:${tenant.tenantId}:${clientIp(req)}`, limit: 20, windowMs: 60_000 }],
    "Demasiadas verificaciones seguidas. Esperá un momento.",
  );
  if (limited) return limited;

  let body: { orderId?: string; paymentId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const orderId = body.orderId ?? "";
  const paymentId = String(body.paymentId ?? "");
  if (!UUID.test(orderId) || !/^[0-9]{1,20}$/.test(paymentId)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const merchantId = await mainMerchantId(tenant.tenantId);
  const creds = merchantId ? await mercadoPagoCredentials(tenant.tenantId, merchantId) : null;
  if (!creds) return NextResponse.json({ error: "mercadopago_unavailable" }, { status: 400 });

  let payment;
  try {
    payment = await mercadoPagoProvider(creds).getPayment(paymentId);
  } catch {
    return NextResponse.json({ error: "mp_lookup_failed" }, { status: 502 });
  }
  if (payment.externalReference !== orderId) return NextResponse.json({ error: "not_this_order" }, { status: 400 });

  const res = await applyMercadoPagoPayment(db(), { tenantId: tenant.tenantId, payment });
  if (!res.ok) return NextResponse.json({ error: "apply_failed", status: payment.status }, { status: 409 });
  return NextResponse.json({ ok: true, status: payment.status, result: res.value.kind });
}
