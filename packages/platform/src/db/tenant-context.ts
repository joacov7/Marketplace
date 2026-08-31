import type { Sql, TransactionSql } from "postgres";

/**
 * Ejecuta `fn` dentro de una transacción con `app.tenant_id` seteado (local a la tx), de
 * modo que TODA query dentro queda restringida por RLS al tenant indicado (D4). Es el
 * único camino recomendado para tocar tablas scopeadas por tenant: si alguien olvida el
 * WHERE, la base igual niega las filas ajenas.
 *
 * `set_config(..., true)` hace el seteo local a la transacción → seguro con el pooling de
 * Neon en modo transacción (no se filtra a la próxima query de la conexión).
 */
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
