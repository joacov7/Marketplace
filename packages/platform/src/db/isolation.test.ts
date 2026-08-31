import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { withTenant } from "./tenant-context.js";

/**
 * Test del invariante #1 de seguridad: un tenant NO puede ver datos de otro (D4/[S1]).
 * Requiere un Postgres real: se salta si no hay TEST_DATABASE_URL. En CI/Neon corre y
 * es gate de merge.
 */
const url = process.env.TEST_DATABASE_URL;
const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!url)("Aislamiento multi-tenant por RLS", () => {
  let sql: postgres.Sql;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    sql = postgres(url!, { max: 4, onnotice: () => {} });
    const migration = readFileSync(join(here, "migrations", "0000_init.sql"), "utf8");
    await sql.unsafe(migration);
    // tenants viven fuera de RLS (registro de plataforma).
    const [a] = await sql<{ id: string }[]>`insert into tenants (slug, name) values (${"t-a-" + Date.now()}, 'A') returning id`;
    const [b] = await sql<{ id: string }[]>`insert into tenants (slug, name) values (${"t-b-" + Date.now()}, 'B') returning id`;
    tenantA = a!.id;
    tenantB = b!.id;
    await withTenant(sql, tenantA, (tx) => tx`insert into merchants (tenant_id, slug, name) values (${tenantA}, 'petshop-a', 'Pet Shop A')`);
    await withTenant(sql, tenantB, (tx) => tx`insert into merchants (tenant_id, slug, name) values (${tenantB}, 'petshop-b', 'Pet Shop B')`);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("cada tenant ve SOLO sus merchants", async () => {
    const seenByA = await withTenant(sql, tenantA, (tx) => tx<{ name: string }[]>`select name from merchants`);
    const seenByB = await withTenant(sql, tenantB, (tx) => tx<{ name: string }[]>`select name from merchants`);
    expect(seenByA.map((r) => r.name)).toEqual(["Pet Shop A"]);
    expect(seenByB.map((r) => r.name)).toEqual(["Pet Shop B"]);
  });

  it("el tenant B no puede leer los merchants del tenant A (aunque conozca el id)", async () => {
    const rows = await withTenant(sql, tenantB, (tx) => tx`select * from merchants where tenant_id = ${tenantA}`);
    expect(rows.length).toBe(0);
  });

  it("el tenant B no puede insertar filas atribuidas al tenant A (WITH CHECK)", async () => {
    await expect(
      withTenant(sql, tenantB, (tx) => tx`insert into merchants (tenant_id, slug, name) values (${tenantA}, 'intruso', 'Intruso')`),
    ).rejects.toThrow();
  });

  it("sin contexto de tenant no se ve nada (falla cerrado)", async () => {
    const rows = await sql`select * from merchants`;
    expect(rows.length).toBe(0);
  });
});
