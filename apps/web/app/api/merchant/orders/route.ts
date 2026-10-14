import { NextResponse } from "next/server";
import { listSellerOrders } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cola de pedidos del comercio (seller_orders pagados). Gated por token de servicio
 * (demo; el login de staff del comercio con RBAC + MFA es el paso siguiente).
 */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  const rows = await db().withTenant(tenant.tenantId, (tx) => listSellerOrders(tx));
  return NextResponse.json({
    orders: rows.map((r) => ({
      sellerOrderId: r.sellerOrderId,
      orderId: r.orderId,
      orderStatus: r.orderStatus,
      status: r.status,
      subtotalMinor: r.subtotalMinor.toString(),
      currency: r.currency,
      itemCount: r.itemCount,
      items: r.items,
      petName: r.petName,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      channel: r.channel,
      needsAcceptance: r.needsAcceptance,
      createdAt: r.createdAt,
    })),
  });
}
