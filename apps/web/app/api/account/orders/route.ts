import { NextResponse } from "next/server";
import { listCustomerOrders } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** "Mis pedidos": historial del cliente logueado. Usa el tenant de la propia sesión. */
export async function GET() {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db().withTenant(session.tenantId, (tx) => listCustomerOrders(tx, session.userId));
  return NextResponse.json({
    orders: rows.map((r) => ({
      orderId: r.orderId,
      status: r.status,
      fulfillment: r.fulfillment,
      currency: r.currency,
      totalMinor: r.totalMinor.toString(),
      deliveryChargeMinor: r.deliveryChargeMinor.toString(),
      itemCount: r.itemCount,
      petName: r.petName,
      paymentStatus: r.paymentStatus,
      createdAt: r.createdAt,
    })),
  });
}
