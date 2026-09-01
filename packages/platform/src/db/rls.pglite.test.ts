import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./pglite.testsupport.js";
import type { TenantAwareDb } from "./port.js";

/**
 * Prueba REAL de la política RLS de 0000_init.sql sobre Postgres (WASM, sin servidor): el
 * invariante #1 de seguridad (D4/[S1]). Corre siempre en `npm test`, vía el port.
 */
describe("RLS — aislamiento multi-tenant (PGlite / Postgres real)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
    const [a] = await db.query<{ id: string }>("insert into tenants (slug, name) values ('t-a','A') returning id");
    const [b] = await db.query<{ id: string }>("insert into tenants (slug, name) values ('t-b','B') returning id");
    tenantA = a!.id;
    tenantB = b!.id;
    await db.withTenant(tenantA, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-a','Pet Shop A')", [tenantA]));
    await db.withTenant(tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'petshop-b','Pet Shop B')", [tenantB]));
  });

  afterAll(async () => {
    await pg?.close();
  });

  it("cada tenant ve SOLO sus merchants", async () => {
    const a = await db.withTenant(tenantA, (tx) => tx.query<{ name: string }>("select name from merchants"));
    const b = await db.withTenant(tenantB, (tx) => tx.query<{ name: string }>("select name from merchants"));
    expect(a.map((r) => r.name)).toEqual(["Pet Shop A"]);
    expect(b.map((r) => r.name)).toEqual(["Pet Shop B"]);
  });

  it("el tenant B no ve los merchants de A ni conociendo su id", async () => {
    const rows = await db.withTenant(tenantB, (tx) => tx.query("select * from merchants where tenant_id = $1", [tenantA]));
    expect(rows.length).toBe(0);
  });

  it("el tenant B no puede insertar filas atribuidas al tenant A (WITH CHECK)", async () => {
    await expect(
      db.withTenant(tenantB, (tx) => tx.query("insert into merchants (tenant_id, slug, name) values ($1,'intruso','Intruso')", [tenantA])),
    ).rejects.toThrow();
  });

  it("sin contexto de tenant no se ve nada (falla cerrado)", async () => {
    const rows = await db.tx((tx) => tx.query("select * from merchants"));
    expect(rows.length).toBe(0);
  });
});
