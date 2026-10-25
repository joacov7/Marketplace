import { NextResponse } from "next/server";
import { getOrderTracking } from "@commerce/modules/orders";
import { orderPointsEarned } from "@commerce/modules/loyalty";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Seguimiento público de un pedido (sin login). El orderId es un UUID no adivinable = la llave.
 * Requiere el tenant (slug) para resolver el comercio y correr bajo RLS. Devuelve solo el
 * semáforo + datos no sensibles (etapa, mascota, total, ventana). Corre con contexto de tenant.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const found = await db().withTenant(tenant.tenantId, async (tx) => {
    const tracking = await getOrderTracking(tx, params.id);
    // Solo los puntos que sumó ESTE pedido; el saldo total no se muestra sin login.
    return tracking ? { tracking, pointsEarned: await orderPointsEarned(tx, params.id) } : null;
  });
  const t = found?.tracking;
  if (!found || !t) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    stage: t.stage,
    step: t.step,
    label: t.label,
    petName: t.petName,
    itemCount: t.itemCount,
    totalMinor: t.totalMinor.toString(),
    currency: t.currency,
    deliveryWindow: t.deliveryWindow,
    createdAt: t.createdAt,
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    pointsEarned: found.pointsEarned,
  });
}
