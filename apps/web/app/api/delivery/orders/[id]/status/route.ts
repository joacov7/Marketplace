import { NextResponse } from "next/server";
import { transitionSellerOrder } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireDeliveryAccess } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * El repartidor marca "En camino" (in_transit) o "No se pudo entregar" (delivery_failed).
 * `params.id` = sellerOrderId. La entrega + cobro va por /deliver. Acceso por PIN de reparto.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  if (!(await requireDeliveryAccess(tenant.tenantId))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { to?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.to !== "in_transit" && body.to !== "delivery_failed") {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const res = await transitionSellerOrder(db(), tenant.tenantId, params.id, body.to);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ ok: true, status: body.to });
}
