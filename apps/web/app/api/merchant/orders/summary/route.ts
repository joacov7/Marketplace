import { NextResponse } from "next/server";
import { orderAttentionSummary } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Resumen liviano de la cola para avisar pedidos nuevos: el panel lo consulta cada 30 s (en
 * cualquier pestaña) y, si cambió el último pedido, suena y recarga. Mismo acceso que la cola.
 */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const s = await db().withTenant(tenant.tenantId, (tx) => orderAttentionSummary(tx));
  return NextResponse.json(s, { headers: { "cache-control": "no-store" } });
}
