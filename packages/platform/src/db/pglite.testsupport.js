import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/**
 * Adaptador del port `Db` sobre PGlite (Postgres real en WASM) SOLO para tests. No se
 * compila al build de producción (excluido en tsconfig) ni se importa desde `index.ts`.
 * Hace SET LOCAL ROLE commerce_app para no correr como superusuario (que bypassea RLS),
 * replicando el rol no-superusuario con el que la app conecta en Neon.
 */
export function pgliteDb(pg) {
    const wrap = (exec) => ({
        query: async (text, params = []) => (await exec.query(text, params)).rows,
    });
    return {
        query: async (text, params = []) => (await pg.query(text, params)).rows,
        tx: (fn) => pg.transaction(async (t) => {
            await t.query("set local role commerce_app");
            return fn(wrap(t));
        }),
        withTenant: (tenantId, fn) => pg.transaction(async (t) => {
            await t.query("set local role commerce_app");
            await t.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
            return fn(wrap(t));
        }),
    };
}
/**
 * Crea una PGlite con la migración base aplicada, para tests. Los módulos pasan sus
 * propias migraciones en `extraMigrations` (SQL ya leído), que se aplican en orden luego
 * de la base — así cada módulo es dueño de sus tablas sin que platform las conozca.
 */
export async function freshDb(extraMigrations = []) {
    const here = dirname(fileURLToPath(import.meta.url));
    const pg = await PGlite.create();
    await pg.exec(readFileSync(join(here, "migrations", "0000_init.sql"), "utf8"));
    for (const sql of extraMigrations)
        await pg.exec(sql);
    return { pg, db: pgliteDb(pg) };
}
//# sourceMappingURL=pglite.testsupport.js.map