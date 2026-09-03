import { NextResponse } from "next/server";
import { transitionSellerOrder, completeOrder } from "@commerce/modules/orders";
import { settleCashOnDelivery } from "@commerce/modules/payments";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const COD_METHODS = new Set(["efectivo", "pos", "transferencia"]);

/**
 * ENTREGADO + COBRO. El repartidor entrega el pedido y registra el cobro en la puerta:
 *  1. Marca el seller_order 'delivered'.
 *  2. Registra el cobro (si estaba pendiente): crea el pago 'captured' y postea el ledger, así
 *     recién ahí impacta reportes. `collect` = efectivo/pos/transferencia; "online"/"ya_pago"
 *     = ya estaba pagado → no se cobra de nuevo.
 *  3. Cierra el pedido ('completed').
 * `params.id` = sellerOrderId. Gated por token de servicio. Corre bajo RLS por tenant.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { collect?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Resolver el pedido a partir del seller_order (bajo contexto de tenant).
  const found = await db().withTenant(tenant.tenantId, async (tx) => {
    const [r] = await tx.query<{ order_id: string }>("select order_id from seller_orders where id = $1", [params.id]);
    return r?.order_id ?? null;
  });
  if (!found) return NextResponse.json({ error: "seller_order_not_found" }, { status: 404 });

  // 1. Entregado.
  const t = await transitionSellerOrder(db(), tenant.tenantId, params.id, "delivered");
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: 409 });

  // 2. Cobro (solo si es un método al recibir; "online"/"ya_pago" no cobra de nuevo).
  let paid: { paymentId: string; alreadyPaid: boolean } | null = null;
  if (body.collect && COD_METHODS.has(body.collect)) {
    const s = await settleCashOnDelivery(db(), { tenantId: tenant.tenantId, orderId: found, method: body.collect as "efectivo" | "pos" | "transferencia" });
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: 409 });
    paid = s.value;
  }

  // 3. Cierre del pedido.
  const c = await completeOrder(db(), tenant.tenantId, found);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 409 });

  return NextResponse.json({ ok: true, orderId: found, collected: paid ? !paid.alreadyPaid : false });
}
