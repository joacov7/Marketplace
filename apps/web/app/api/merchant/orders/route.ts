import { NextResponse } from "next/server";
import { listSellerOrders } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cola de pedidos del comercio (seller_orders pagados). Gated por token de servicio
 * (demo; el login de staff del comercio con RBAC + MFA es el paso siguiente).
 */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listSellerOrders(tx));
  return NextResponse.json({
    orders: rows.map((r) => ({
      sellerOrderId: r.sellerOrderId,
      orderId: r.orderId,
      status: r.status,
      subtotalMinor: r.subtotalMinor.toString(),
      currency: r.currency,
      itemCount: r.itemCount,
      createdAt: r.createdAt,
    })),
  });
}
