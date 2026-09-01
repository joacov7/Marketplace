/**
 * Port de base de datos. Los módulos dependen de esta interfaz, NO de un driver concreto
 * (postgres.js, PGlite, etc.) — parte del enforcement de fronteras del monolito modular
 * ([A1]) y lo que permite testear sobre Postgres-en-WASM y correr sobre Neon sin cambiar
 * la lógica.
 */
export interface Db {
  /** Ejecuta una query parametrizada ($1, $2, …) y devuelve las filas. */
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface TenantAwareDb extends Db {
  /**
   * Abre una transacción con `app.tenant_id` seteado → toda query dentro queda
   * restringida por RLS al tenant (D4). Único camino para tocar tablas de dominio.
   */
  withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T>;

  /**
   * Transacción SIN tenant, para operaciones de plataforma (crear tenants, drenar el
   * outbox): no toca tablas bajo RLS de tenant, o las accede como plataforma.
   */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}
