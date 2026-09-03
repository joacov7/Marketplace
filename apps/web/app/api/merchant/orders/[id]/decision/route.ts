import { NextResponse } from "next/server";
import { confirmOrder, cancelOrder } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * El comercio ACEPTA o RECHAZA un pedido de pago al recibir (los que entran "a aceptar").
 *  - aceptar  → confirmOrder: consume las reservas (venta comprometida), pasa a 'confirmed'.
 *               El pago sigue pendiente (se cobra al entregar, fuera de este eslabón).
 *  - rechazar → cancelOrder: libera las reservas y pasa a 'cancelled'. NO se borra: queda
 *               en historial/reportes.
 * `params.id` es el ORDER id. Gated por token de servicio (login de staff con RBAC = paso
 * siguiente). Corre con contexto de tenant (RLS) → aislado por comercio.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { decision?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.decision !== "aceptar" && body.decision !== "rechazar") {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }

  const res =
    body.decision === "aceptar"
      ? await confirmOrder(db(), tenant.tenantId, params.id)
      : await cancelOrder(db(), tenant.tenantId, params.id);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

  return NextResponse.json({ ok: true, decision: body.decision, orderStatus: body.decision === "aceptar" ? "confirmed" : "cancelled" });
}
