import { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "./port.js";
/**
 * Adaptador del port `Db` sobre PGlite (Postgres real en WASM) SOLO para tests. No se
 * compila al build de producción (excluido en tsconfig) ni se importa desde `index.ts`.
 * Hace SET LOCAL ROLE commerce_app para no correr como superusuario (que bypassea RLS),
 * replicando el rol no-superusuario con el que la app conecta en Neon.
 */
export declare function pgliteDb(pg: PGlite): TenantAwareDb;
/**
 * Crea una PGlite con la migración base aplicada, para tests. Los módulos pasan sus
 * propias migraciones en `extraMigrations` (SQL ya leído), que se aplican en orden luego
 * de la base — así cada módulo es dueño de sus tablas sin que platform las conozca.
 */
export declare function freshDb(extraMigrations?: string[]): Promise<{
    pg: PGlite;
    db: TenantAwareDb;
}>;
//# sourceMappingURL=pglite.testsupport.d.ts.map