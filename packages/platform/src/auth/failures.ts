import type { Db } from "../db/port.js";

/**
 * Contadores con ventana fija guardados en Postgres (tabla auth_failures) para que los
 * compartan todas las rutas e instancias serverless: intentos FALLIDOS de autenticación y
 * límites de frecuencia de endpoints públicos (`consumeRateLimit`).
 *
 * Intentos fallidos: Consultar no suma: se pregunta "¿está
 * bloqueado?" ANTES de validar la credencial y solo se registra el fallo si es incorrecta.
 */

/** El mayor conteo vigente entre `keys` y cuánto falta (ms) para que venza su ventana. */
export async function failureStatus(
  db: Db,
  keys: readonly string[],
): Promise<Array<{ key: string; count: number; retryAfterMs: number }>> {
  if (keys.length === 0) return [];
  const rows = await db.query<{ key: string; count: number; retry_ms: string }>(
    `select key, count, (extract(epoch from (reset_at - now())) * 1000)::bigint::text as retry_ms
       from auth_failures where key = any($1::text[]) and reset_at > now()`,
    [keys as string[]],
  );
  return rows.map((r) => ({ key: r.key, count: Number(r.count), retryAfterMs: Math.max(0, Number(r.retry_ms)) }));
}

/** Suma un fallo a cada clave. La ventana empieza con el primer fallo y no se estira. */
export async function recordFailures(db: Db, keys: readonly string[], windowMs: number): Promise<void> {
  for (const key of keys) {
    await db.query(
      `insert into auth_failures (key, count, reset_at)
       values ($1, 1, now() + ($2 || ' milliseconds')::interval)
       on conflict (key) do update set
         count    = case when auth_failures.reset_at <= now() then 1 else auth_failures.count + 1 end,
         reset_at = case when auth_failures.reset_at <= now() then excluded.reset_at else auth_failures.reset_at end`,
      [key, String(Math.max(0, Math.round(windowMs)))],
    );
  }
}

/** Borra contadores vencidos (lo corre el cron diario). Devuelve cuántos borró. */
export async function purgeExpiredFailures(db: Db): Promise<number> {
  const rows = await db.query<{ key: string }>(`delete from auth_failures where reset_at <= now() returning key`);
  return rows.length;
}

/**
 * Límite de frecuencia compartido (misma tabla): SUMA 1 a `key` y dice si se pasó de `limit`
 * dentro de la ventana. Atómico (un solo upsert), así dos instancias no se pisan.
 */
export async function consumeRateLimit(
  db: Db,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; count: number; retryAfterMs: number }> {
  const [r] = await db.query<{ count: number; retry_ms: string }>(
    `insert into auth_failures (key, count, reset_at)
     values ($1, 1, now() + ($2 || ' milliseconds')::interval)
     on conflict (key) do update set
       count    = case when auth_failures.reset_at <= now() then 1 else auth_failures.count + 1 end,
       reset_at = case when auth_failures.reset_at <= now() then excluded.reset_at else auth_failures.reset_at end
     returning count, (extract(epoch from (reset_at - now())) * 1000)::bigint::text as retry_ms`,
    [key, String(Math.max(0, Math.round(windowMs)))],
  );
  const count = Number(r!.count);
  return { ok: count <= limit, count, retryAfterMs: Math.max(0, Number(r!.retry_ms)) };
}
