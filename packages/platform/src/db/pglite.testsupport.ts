import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Db, TenantAwareDb } from "./port.js";

/**
 * Adaptador del port `Db` sobre PGlite (Postgres real en WASM) SOLO para tests. No se
 * compila al build de producción (excluido en tsconfig) ni se importa desde `index.ts`.
 * Hace SET LOCAL ROLE commerce_app para no correr como superusuario (que bypassea RLS),
 * replicando el rol no-superusuario con el que la app conecta en Neon.
 */
export function pgliteDb(pg: PGlite): TenantAwareDb {
  const wrap = (exec: { query: PGlite["query"] }): Db => ({
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await exec.query(text, params as unknown[])).rows as T[],
  });

  return {
    query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) =>
      (await pg.query(text, params as unknown[])).rows as T[],

    tx: <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
      pg.transaction(async (t) => {
        await t.query("set local role commerce_app");
        return fn(wrap(t));
      }) as Promise<T>,

    withTenant: <T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> =>
      pg.transaction(async (t) => {
        await t.query("set local role commerce_app");
        await t.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        return fn(wrap(t));
      }) as Promise<T>,
  };
}

/** Crea una PGlite con la migración base aplicada, para tests. */
export async function freshDb(): Promise<{ pg: PGlite; db: TenantAwareDb }> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pg = await PGlite.create();
  const migration = readFileSync(join(here, "migrations", "0000_init.sql"), "utf8");
  await pg.exec(migration);
  return { pg, db: pgliteDb(pg) };
}
