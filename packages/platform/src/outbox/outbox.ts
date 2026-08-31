import type { Sql, TransactionSql } from "postgres";
import type { DomainEvent } from "@commerce/contracts";

/**
 * Encola un evento DENTRO de la transacción del cambio de estado (patrón outbox): si la
 * tx hace rollback, el evento no queda; si commitea, el evento queda garantizado. Evita
 * el dual-write pedido↔pago↔notificación (A2).
 */
export async function enqueueEvent(
  tx: TransactionSql,
  evt: { tenantId: string; type: string; version?: number; payload: unknown },
): Promise<void> {
  await tx`
    insert into outbox_events (tenant_id, type, version, payload)
    values (${evt.tenantId}, ${evt.type}, ${evt.version ?? 1}, ${tx.json(evt.payload as never)})
  `;
}

/**
 * Drena eventos pendientes y los publica vía `publish`. En Vercel lo llama un Cron/QStash
 * (no hay worker residente — A2). Marca como 'published' solo los que se publicaron OK, en
 * la misma tx, para no perder ni duplicar. Devuelve cuántos publicó.
 *
 * Nota: lee con FOR UPDATE SKIP LOCKED para que varias invocaciones concurrentes del cron
 * no procesen el mismo evento.
 */
export async function drainOutbox(
  sql: Sql,
  publish: (evt: DomainEvent) => Promise<void>,
  limit = 100,
): Promise<number> {
  let published = 0;
  await sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; tenant_id: string; type: string; version: number; payload: unknown; occurred_at: string }[]
    >`
      select id, tenant_id, type, version, payload, occurred_at
      from outbox_events
      where status = 'pending'
      order by occurred_at
      limit ${limit}
      for update skip locked
    `;
    for (const r of rows) {
      await publish({
        id: r.id,
        tenantId: r.tenant_id,
        type: r.type,
        version: r.version,
        payload: r.payload,
        occurredAt: new Date(r.occurred_at).toISOString(),
      });
      await tx`update outbox_events set status = 'published', published_at = now() where id = ${r.id}`;
      published++;
    }
  });
  return published;
}
