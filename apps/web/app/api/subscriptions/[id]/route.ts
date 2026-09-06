import { NextResponse } from "next/server";
import { updateSubscription, type SubscriptionStatus } from "@commerce/modules/subscriptions";
import { findCustomerByPhone } from "@commerce/modules/customer";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS = new Set(["active", "paused", "cancelled"]);

/**
 * El cliente pausa / reanuda / cancela o ajusta SU suscripción. Verifica propiedad (por
 * sesión o teléfono) antes de tocar nada: nadie modifica la suscripción de otro.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { status?: string; intervalDays?: number; qty?: number; phone?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.status && !STATUS.has(body.status)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

  const session = readSession();

  try {
    const okOwner = await db().withTenant(tenant.tenantId, async (tx) => {
      const rows = await tx.query<{ customer_id: string | null }>(
        "select customer_id from subscriptions where id = $1",
        [params.id],
      );
      if (rows.length === 0) return "not_found";

      // Propiedad: la ficha de la suscripción debe ser la del cliente que pide el cambio.
      let customerId: string | null = session?.userId ?? null;
      if (!customerId && body.phone) {
        const c = await findCustomerByPhone(tx, body.phone);
        customerId = c?.id ?? null;
      }
      if (!customerId || rows[0]!.customer_id !== customerId) return "forbidden";

      await updateSubscription(tx, params.id, {
        ...(body.status ? { status: body.status as SubscriptionStatus } : {}),
        ...(body.intervalDays !== undefined ? { intervalDays: Math.round(Number(body.intervalDays)) } : {}),
        ...(body.qty !== undefined ? { qty: Math.round(Number(body.qty)) } : {}),
      });
      return "ok";
    });

    if (okOwner === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (okOwner === "forbidden") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
