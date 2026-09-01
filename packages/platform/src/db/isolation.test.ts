import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { pgDb } from "./pg.js";

/**
 * Igual que rls.pglite.test.ts pero contra un Postgres REAL vía postgres.js (el driver de
 * producción). Valida además el adaptador `pgDb`. Se salta si no hay TEST_DATABASE_URL;
 * en CI/Neon corre y es gate de merge. La conexión debe usar un rol NO-superusuario para
 * que FORCE RLS aplique.
 */
const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("Aislamiento multi-tenant por RLS (postgres.js / Neon)", () => {
  let sql: postgres.Sql;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    sql = postgres(url!, { max: 4, onnotice: () => {} });
    const migration = readFileSync(join(here, "migrations", "0000_init.sql"), "utf8");
    await sql.unsafe(migration);
    const db = pgDb(sql);
    const [a] = await db.query<{ id: string }>(`insert into tenants (slug, name) values ($1, 'A') returning id`, [
      "t-a-" + Date.now(),
    ]);
    const [b] = await db.query<{ id: string }>(`insert into tenants (slug, name) values ($1, 'B') returning id`, [
      "t-b-" + Date.now(),
    ]);
    tenantA = a!.id;
    tenantB = b!.id;
    await db.withTenant(tenantA, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-a','A')", [tenantA]));
    await db.withTenant(tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-b','B')", [tenantB]));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("cada tenant ve SOLO sus merchants", async () => {
    const db = pgDb(sql);
    const a = await db.withTenant(tenantA, (tx) => tx.query<{ name: string }>("select name from merchants"));
    const b = await db.withTenant(tenantB, (tx) => tx.query<{ name: string }>("select name from merchants"));
    expect(a.map((r) => r.name)).toEqual(["A"]);
    expect(b.map((r) => r.name)).toEqual(["B"]);
  });

  it("el tenant B no puede insertar filas atribuidas al tenant A", async () => {
    const db = pgDb(sql);
    await expect(
      db.withTenant(tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'x','x')", [tenantA])),
    ).rejects.toThrow();
  });
});
