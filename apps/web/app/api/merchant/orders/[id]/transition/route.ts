import { NextResponse } from "next/server";
import { transitionSellerOrder } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  paid_refund_required:
    "Este pedido ya está cobrado. Para cancelarlo, confirmá que le vas a devolver el dinero al cliente (si pagó con Mercado Pago, desde tu cuenta de MP).",
};

/**
 * Avanza el cumplimiento de un seller_order (preparing/ready/in_transit/delivered/…). Rechazar o
 * cancelar devuelve el stock y cancela el pedido; si ya está cobrado pide `refundAcknowledged`.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { to?: string; refundAcknowledged?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.to) return NextResponse.json({ error: "missing_to" }, { status: 400 });

  const res = await transitionSellerOrder(db(), tenant.tenantId, params.id, body.to as never, {
    refundAcknowledged: body.refundAcknowledged === true,
  });
  if (!res.ok) return NextResponse.json({ error: res.error, message: ERROR_MESSAGE[res.error] }, { status: 409 });
  return NextResponse.json({ ok: true, status: body.to });
}
