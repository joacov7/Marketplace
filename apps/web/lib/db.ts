import postgres from "postgres";
import { pgDb, type TenantAwareDb } from "@commerce/platform";

/**
 * Cliente Postgres singleton para la app (Neon). `prepare: false` es amigable con el
 * pooler de Neon en modo transacción. En producción la conexión usa un rol
 * NO-superusuario (para que FORCE RLS aplique). El aislamiento por tenant lo da
 * `db().withTenant(...)`.
 */
let _sql: ReturnType<typeof postgres> | null = null;

function sql(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no configurada");
    _sql = postgres(url, { max: 5, prepare: false });
  }
  return _sql;
}

export function db(): TenantAwareDb {
  return pgDb(sql());
}
