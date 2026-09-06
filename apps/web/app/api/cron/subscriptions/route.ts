import { NextResponse } from "next/server";
import { generateDueOrdersForTenant } from "@commerce/modules/subscriptions";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Genera los pedidos de las suscripciones vencidas de todos los comercios activos. La dispara
 * Vercel Cron (diario). Gated por CRON_SECRET. Cada tenant se procesa con su contexto (RLS);
 * los pedidos entran a la cola "por aceptar" y se cobran al entregar.
 */
export async function GET() {
  if (!requireServiceToken("CRON_SECRET")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenants = await db().query<{ id: string }>("select id from tenants where status = 'active'");
  let created = 0;
  let skipped = 0;
  const errors: Array<{ tenantId: string; error: string }> = [];

  for (const t of tenants) {
    try {
      const r = await generateDueOrdersForTenant(db(), t.id);
      created += r.created;
      skipped += r.skipped;
    } catch (e) {
      errors.push({ tenantId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ created, skipped, tenants: tenants.length, ...(errors.length ? { errors } : {}) });
}
