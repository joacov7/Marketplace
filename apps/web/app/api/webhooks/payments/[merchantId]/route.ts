import { NextResponse } from "next/server";
import { capturePayment } from "@commerce/modules/payments";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Webhook de pago. En V1 el PSP se configura para pegarle a la URL por-tenant
 * (subdominio), así el tenant se resuelve por Host y la captura corre con contexto de
 * tenant. La verificación de firma real (por-merchant) se agrega con la integración MP;
 * acá se acepta un body JSON con { providerEventId, providerRef, type } y un header
 * `x-signature: valid` en desarrollo. La captura es idempotente por providerEventId.
 */
export async function POST(req: Request, { params }: { params: { merchantId: string } }) {
  const tenant = await resolveTenant();
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const signature = req.headers.get("x-signature");
  if (signature !== "valid") return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  let event: { providerEventId?: string; providerRef?: string; type?: string };
  try {
    event = (await req.json()) as typeof event;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!event.providerEventId || !event.providerRef) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Siempre 200 para eventos no manejados (el PSP no debe reintentar indefinidamente).
  if (event.type && event.type !== "payment.approved") {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const res = await capturePayment(db(), {
    tenantId: tenant.tenantId,
    providerEventId: event.providerEventId,
    providerRef: event.providerRef,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  return NextResponse.json({ ok: true, merchant: params.merchantId, ...res.value });
}
