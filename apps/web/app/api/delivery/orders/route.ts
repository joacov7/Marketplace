import { NextResponse } from "next/server";
import { listDeliveryOrders } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cola de reparto (pantalla del cadete): pedidos listos para salir o en camino, con dirección,
 * referencias, teléfono del cliente, mascota y monto a cobrar. Gated por token de servicio
 * (para arrancar, un PIN simple = el mismo token; el acceso por repartidor con login es un
 * paso siguiente del roadmap). Corre con contexto de tenant (RLS).
 */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listDeliveryOrders(tx));
  return NextResponse.json({
    orders: rows.map((r) => ({
      sellerOrderId: r.sellerOrderId,
      orderId: r.orderId,
      status: r.status,
      petName: r.petName,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      addressStreet: r.addressStreet,
      addressZone: r.addressZone,
      addressNotes: r.addressNotes,
      deliveryWindow: r.deliveryWindow,
      amountToCollectMinor: r.amountToCollectMinor.toString(),
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      items: r.items,
      createdAt: r.createdAt,
    })),
  });
}
