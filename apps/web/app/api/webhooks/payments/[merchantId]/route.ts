import { NextResponse } from "next/server";
import {
  applyMercadoPagoPayment,
  parseMercadoPagoNotification,
  verifyMercadoPagoSignature,
} from "@commerce/modules/payments";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { mercadoPagoCredentials, mercadoPagoProvider } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Webhook de Mercado Pago (la URL va en cada preferencia: por comercio y con el tenant).
 *
 * El aviso NO se cree: solo dice "pasó algo con el pago X". Se consulta ese pago a la API de MP
 * con el token del comercio y se aplica lo que MP responde (approved → captura idempotente con
 * control de monto). Si el comercio cargó la clave secreta de webhooks, además se valida la
 * firma `x-signature` (rechaza avisos falsos antes de llamar a MP).
 *
 * Respuestas: 200 para todo lo que no hay que reintentar (otros tópicos, pagos ajenos,
 * no aprobados); 5xx solo para fallas transitorias (MP reintenta).
 */
export async function POST(req: Request, { params }: { params: { merchantId: string } }) {
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  if (!UUID.test(params.merchantId)) return NextResponse.json({ error: "invalid_merchant" }, { status: 400 });

  let body: unknown = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const note = parseMercadoPagoNotification({ query: url.searchParams, body });
  if (!note) return NextResponse.json({ ok: true, ignored: "topic" });

  const creds = await mercadoPagoCredentials(tenant.tenantId, params.merchantId);
  if (!creds) {
    console.error(`[webhook:mercadopago] tenant=${tenant.slug} merchant=${params.merchantId} sin credenciales`);
    return NextResponse.json({ ok: true, ignored: "no_credentials" });
  }

  if (creds.webhookSecret) {
    const valid = verifyMercadoPagoSignature({
      signatureHeader: req.headers.get("x-signature"),
      requestId: req.headers.get("x-request-id"),
      dataId: url.searchParams.get("data.id") ?? note.paymentId,
      secret: creds.webhookSecret,
    });
    if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payment;
  try {
    payment = await mercadoPagoProvider(creds).getPayment(note.paymentId);
  } catch (e) {
    console.error(`[webhook:mercadopago] tenant=${tenant.slug} payment=${note.paymentId} consulta falló: ${String(e)}`);
    return NextResponse.json({ error: "mp_lookup_failed" }, { status: 502 });
  }

  const res = await applyMercadoPagoPayment(db(), { tenantId: tenant.tenantId, payment });
  if (!res.ok) {
    console.error(`[webhook:mercadopago] tenant=${tenant.slug} payment=${payment.id} ref=${payment.externalReference} ${res.error}`);
    // Un monto distinto no se arregla reintentando: se registra y se responde 200.
    if (res.error.startsWith("amount_mismatch")) return NextResponse.json({ ok: true, ignored: "amount_mismatch" });
    return NextResponse.json({ error: "apply_failed" }, { status: 500 });
  }
  if (res.value.kind === "late_payment") {
    console.error(`[webhook:mercadopago] tenant=${tenant.slug} order=${res.value.orderId} PAGO TARDÍO de un pedido cancelado (MP ${res.value.mpPaymentId}): reembolsar desde Mercado Pago`);
  }
  if (res.value.kind === "captured" && res.value.stockShortfall) {
    console.error(`[webhook:mercadopago] tenant=${tenant.slug} order=${payment.externalReference} cobrado SIN stock: ${res.value.stockShortfall.join(",")}`);
  }
  return NextResponse.json({ ok: true, result: res.value.kind });
}
