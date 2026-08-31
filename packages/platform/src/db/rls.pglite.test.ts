import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Prueba REAL de la política RLS de 0000_init.sql sobre Postgres (en WASM, sin servidor):
 * el invariante #1 de seguridad (D4/[S1]). Corre siempre en `npm test`. El test contra
 * Neon (isolation.test.ts) valida además el helper postgres.js en el entorno real.
 */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * withTenant equivalente para PGlite. Además de setear app.tenant_id, hace SET LOCAL ROLE
 * commerce_app para NO correr como superusuario (que bypassea RLS). En Neon la app ya
 * conecta con un rol no-superusuario, así que allí basta el set_config.
 */
async function asApp<T>(db: PGlite, tenantId: string | null, fn: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("set local role commerce_app");
    if (tenantId !== null) {
      await tx.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    return fn(tx);
  }) as Promise<T>;
}
const asTenant = <T>(db: PGlite, t: string, fn: (tx: any) => Promise<T>) => asApp(db, t, fn);

describe("RLS — aislamiento multi-tenant (PGlite / Postgres real)", () => {
  let db: PGlite;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    db = await PGlite.create();
    const migration = readFileSync(join(here, "migrations", "0000_init.sql"), "utf8");
    await db.exec(migration);
    const a = await db.query<{ id: string }>("insert into tenants (slug, name) values ('t-a','A') returning id");
    const b = await db.query<{ id: string }>("insert into tenants (slug, name) values ('t-b','B') returning id");
    tenantA = a.rows[0]!.id;
    tenantB = b.rows[0]!.id;
    await asTenant(db, tenantA, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-a','Pet Shop A')", [tenantA]));
    await asTenant(db, tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-b','Pet Shop B')", [tenantB]));
  });

  afterAll(async () => {
    await db?.close();
  });

  it("cada tenant ve SOLO sus merchants", async () => {
    const a = await asTenant(db, tenantA, (tx) => tx.query<{ name: string }>("select name from merchants"));
    const b = await asTenant(db, tenantB, (tx) => tx.query<{ name: string }>("select name from merchants"));
    expect(a.rows.map((r: { name: string }) => r.name)).toEqual(["Pet Shop A"]);
    expect(b.rows.map((r: { name: string }) => r.name)).toEqual(["Pet Shop B"]);
  });

  it("el tenant B no ve los merchants de A ni conociendo su id", async () => {
    const rows = await asTenant(db, tenantB, (tx) => tx.query("select * from merchants where tenant_id = $1", [tenantA]));
    expect(rows.rows.length).toBe(0);
  });

  it("el tenant B no puede insertar filas atribuidas al tenant A (WITH CHECK)", async () => {
    await expect(
      asTenant(db, tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'intruso','Intruso')", [tenantA])),
    ).rejects.toThrow();
  });

  it("sin contexto de tenant no se ve nada (falla cerrado)", async () => {
    const rows = await asApp(db, null, (tx) => tx.query("select * from merchants"));
    expect(rows.rows.length).toBe(0);
  });
});
