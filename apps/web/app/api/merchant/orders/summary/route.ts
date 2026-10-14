import { NextResponse } from "next/server";
import { orderAttentionSummary } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Resumen liviano de la cola para avisar pedidos nuevos: el panel lo consulta cada 30 s (en
 * cualquier pestaña) y, si cambió el último pedido, suena y recarga. Mismo acceso que la cola.
 */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const s = await db().withTenant(tenant.tenantId, (tx) => orderAttentionSummary(tx));
  return NextResponse.json(s, { headers: { "cache-control": "no-store" } });
}
