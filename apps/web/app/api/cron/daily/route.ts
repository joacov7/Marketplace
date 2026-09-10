import { NextResponse } from "next/server";
import { drainOutbox } from "@commerce/platform";
import { releaseExpiredReservations } from "@commerce/modules/inventory";
import { generateDueOrdersForTenant } from "@commerce/modules/subscriptions";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cron diario consolidado (una sola entrada en vercel.json). El plan Hobby de Vercel limita la
 * cantidad de cron jobs, así que las tres tareas de mantenimiento corren desde acá:
 *   1) drena el outbox (eventos pendientes),
 *   2) libera reservas de stock vencidas y repone inventario,
 *   3) genera los pedidos de las suscripciones vencidas (auto-envío).
 * Cada tarea está aislada: si una falla, las otras igual corren y se reporta el error.
 * Gated por CRON_SECRET. Las rutas individuales (/api/cron/outbox|reservations|subscriptions)
 * siguen existiendo para disparar cada tarea a mano.
 */
export async function GET() {
  if (!requireServiceToken("CRON_SECRET")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result: Record<string, unknown> = {};
  const errors: Array<{ task: string; error: string }> = [];
  const fail = (task: string, e: unknown) => errors.push({ task, error: e instanceof Error ? e.message : String(e) });

  // 1) Outbox
  try {
    result.published = await drainOutbox(db(), async (evt) => {
      console.log(`[cron:outbox] ${evt.type} tenant=${evt.tenantId} id=${evt.id}`);
    });
  } catch (e) {
    fail("outbox", e);
  }

  // 2) Reservas vencidas
  try {
    result.released = await releaseExpiredReservations(db());
  } catch (e) {
    fail("reservations", e);
  }

  // 3) Suscripciones vencidas → pedidos (por tenant activo, con su contexto RLS).
  try {
    const tenants = await db().query<{ id: string }>("select id from tenants where status = 'active'");
    let created = 0;
    let skipped = 0;
    for (const t of tenants) {
      try {
        const r = await generateDueOrdersForTenant(db(), t.id);
        created += r.created;
        skipped += r.skipped;
      } catch (e) {
        fail(`subscriptions:${t.id}`, e);
      }
    }
    result.subscriptions = { created, skipped, tenants: tenants.length };
  } catch (e) {
    fail("subscriptions", e);
  }

  return NextResponse.json({ ok: errors.length === 0, ...result, ...(errors.length ? { errors } : {}) });
}
