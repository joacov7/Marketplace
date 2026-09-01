import type { DomainEvent } from "@commerce/contracts";
import type { Db, TenantAwareDb } from "../db/port.js";

/**
 * Encola un evento DENTRO de la transacción del cambio de estado (patrón outbox): si la
 * tx hace rollback, el evento no queda; si commitea, queda garantizado. Evita el
 * dual-write pedido↔pago↔notificación (A2). Se llama con el `Db` de la transacción en
 * curso (p. ej. dentro de un withTenant).
 */
export async function enqueueEvent(
  tx: Db,
  evt: { tenantId: string; type: string; version?: number; payload: unknown },
): Promise<void> {
  await tx.query(
    `insert into outbox_events (tenant_id, type, version, payload)
     values ($1, $2, $3, $4)`,
    [evt.tenantId, evt.type, evt.version ?? 1, JSON.stringify(evt.payload)],
  );
}

/**
 * Drena eventos pendientes y los publica vía `publish`. En Vercel lo llama un Cron/QStash
 * (no hay worker residente — A2). `FOR UPDATE SKIP LOCKED` evita que invocaciones
 * concurrentes procesen el mismo evento; el marcado a 'published' va en la misma tx para
 * no perder ni duplicar. Devuelve cuántos publicó.
 */
export async function drainOutbox(
  db: TenantAwareDb,
  publish: (evt: DomainEvent) => Promise<void>,
  limit = 100,
): Promise<number> {
  return db.tx(async (tx) => {
    const rows = await tx.query<{
      id: string;
      tenant_id: string;
      type: string;
      version: number;
      payload: unknown;
      occurred_at: string;
    }>(
      `select id, tenant_id, type, version, payload, occurred_at
       from outbox_events
       where status = 'pending'
       order by occurred_at
       limit $1
       for update skip locked`,
      [limit],
    );
    let published = 0;
    for (const r of rows) {
      await publish({
        id: r.id,
        tenantId: r.tenant_id,
        type: r.type,
        version: r.version,
        payload: r.payload,
        occurredAt: new Date(r.occurred_at).toISOString(),
      });
      await tx.query(`update outbox_events set status = 'published', published_at = now() where id = $1`, [r.id]);
      published++;
    }
    return published;
  });
}
