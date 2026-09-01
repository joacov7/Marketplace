import type { Sql, TransactionSql } from "postgres";
import type { Db, TenantAwareDb } from "./port.js";

/**
 * Adaptador del port `Db` sobre postgres.js — el driver de producción (Neon/Vercel).
 * `set_config(..., true)` deja `app.tenant_id` local a la transacción, seguro con el
 * pooling de Neon en modo transacción.
 *
 * En producción la app conecta con un rol NO-superusuario dueño de las tablas, de modo
 * que FORCE ROW LEVEL SECURITY lo constriñe (los superusuarios bypassean RLS).
 */
export function pgDb(sql: Sql): TenantAwareDb {
  const wrap = (q: Sql | TransactionSql): Db => ({
    query: <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      q.unsafe(text, params as unknown as never[]) as unknown as Promise<T[]>,
  });

  return {
    query: <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      sql.unsafe(text, params as unknown as never[]) as unknown as Promise<T[]>,

    tx: <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
      sql.begin((t) => fn(wrap(t))) as Promise<T>,

    withTenant: <T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> =>
      sql.begin(async (t) => {
        await t`select set_config('app.tenant_id', ${tenantId}, true)`;
        return fn(wrap(t));
      }) as Promise<T>,
  };
}
