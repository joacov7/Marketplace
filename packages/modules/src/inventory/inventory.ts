import type { Db, TenantAwareDb } from "@commerce/platform";
import { type Result, ok, err } from "@commerce/contracts";

/**
 * Módulo Inventario. El corazón es la RESERVA ATÓMICA que evita oversell ([G1]): el
 * decremento de `available` es condicional (`where available >= qty`), así dos compras
 * concurrentes de la última unidad se serializan sobre la fila y solo una gana. El CHECK
 * `available >= 0` es la última red.
 *
 * Ciclo: reserve (held, con TTL) → confirm (venta) | release (cancel/timeout).
 */

export type ReserveError = "insufficient_stock" | "no_inventory";

/** Setea/repone stock disponible de una variante (upsert). */
export async function setStock(
  db: Db,
  input: { tenantId: string; variantId: string; available: number },
): Promise<void> {
  await db.query(
    `insert into inventory (variant_id, tenant_id, available)
     values ($1,$2,$3)
     on conflict (variant_id) do update set available = excluded.available, updated_at = now()`,
    [input.variantId, input.tenantId, input.available],
  );
}

export async function getStock(
  db: Db,
  variantId: string,
): Promise<{ available: number; reserved: number } | null> {
  const [row] = await db.query<{ available: number; reserved: number }>(
    `select available, reserved from inventory where variant_id = $1`,
    [variantId],
  );
  return row ?? null;
}

/**
 * Reserva `qty` unidades: decremento atómico condicional + fila de reserva 'held' con TTL.
 * Debe correr dentro de una tx de tenant (withTenant). Falla cerrado: si la variante es
 * de otro tenant, RLS la oculta y devuelve `no_inventory`.
 */
export async function reserveStock(
  db: Db,
  input: { tenantId: string; variantId: string; qty: number; orderId?: string; ttlSeconds?: number },
): Promise<Result<{ reservationId: string }, ReserveError>> {
  const ttl = input.ttlSeconds ?? 900; // 15 min por defecto
  const updated = await db.query<{ variant_id: string }>(
    `update inventory
        set available = available - $2, reserved = reserved + $2, updated_at = now()
      where variant_id = $1 and available >= $2
      returning variant_id`,
    [input.variantId, input.qty],
  );
  if (updated.length === 0) {
    const exists = await db.query(`select 1 from inventory where variant_id = $1`, [input.variantId]);
    return err(exists.length > 0 ? "insufficient_stock" : "no_inventory");
  }
  const [r] = await db.query<{ id: string }>(
    `insert into stock_reservations (tenant_id, order_id, variant_id, qty, expires_at)
     values ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)
     returning id`,
    [input.tenantId, input.orderId ?? null, input.variantId, input.qty, String(ttl)],
  );
  return ok({ reservationId: r!.id });
}

/** Confirma una reserva 'held' (la mercadería se vendió): baja `reserved`, no repone. */
export async function confirmReservation(db: Db, reservationId: string): Promise<Result<true, "not_held">> {
  const [res] = await db.query<{ variant_id: string; qty: number }>(
    `update stock_reservations set status = 'confirmed'
      where id = $1 and status = 'held'
      returning variant_id, qty`,
    [reservationId],
  );
  if (!res) return err("not_held");
  await db.query(`update inventory set reserved = reserved - $2, updated_at = now() where variant_id = $1`, [
    res.variant_id,
    res.qty,
  ]);
  return ok(true);
}

/** Libera una reserva 'held' (cancelación): devuelve el stock a `available`. */
export async function releaseReservation(db: Db, reservationId: string): Promise<Result<true, "not_held">> {
  const [res] = await db.query<{ variant_id: string; qty: number }>(
    `update stock_reservations set status = 'released'
      where id = $1 and status = 'held'
      returning variant_id, qty`,
    [reservationId],
  );
  if (!res) return err("not_held");
  await db.query(
    `update inventory set available = available + $2, reserved = reserved - $2, updated_at = now() where variant_id = $1`,
    [res.variant_id, res.qty],
  );
  return ok(true);
}

/**
 * Libera todas las reservas vencidas y repone el stock (tarea de plataforma para el cron).
 * Usa la función SQL SECURITY DEFINER, que corre cross-tenant. Devuelve cuántas liberó.
 */
export async function releaseExpiredReservations(db: TenantAwareDb): Promise<number> {
  const rows = await db.tx((tx) => tx.query<{ n: number }>(`select release_expired_reservations() as n`));
  return rows[0]?.n ?? 0;
}
