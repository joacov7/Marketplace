import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createWithdrawalRequest, listWithdrawalRequests, resolveWithdrawalRequest } from "./withdrawal.js";

describe("botón de arrepentimiento", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  const create = (input: Record<string, unknown>, tid = tenantId) =>
    db.withTenant(tid, (tx) => createWithdrawalRequest(tx, { tenantId: tid, ...input } as never));

  it("crea la solicitud y devuelve un código ARR-XXXXXX", async () => {
    const r = await create({ name: "  Ana   Pérez ", contact: "3444 15 123456", orderRef: "#ab12cd34", message: "Me arrepentí" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.code).toMatch(/^ARR-[2-9A-HJKMNP-Z]{6}$/);
    const list = await db.withTenant(tenantId, (tx) => listWithdrawalRequests(tx));
    expect(list[0]).toMatchObject({ code: r.value.code, name: "Ana Pérez", contact: "3444 15 123456", orderRef: "#ab12cd34", status: "pendiente" });
  });

  it("acepta email como contacto; rechaza nombre o contacto inválidos", async () => {
    expect((await create({ name: "Juan", contact: "juan@mail.com" })).ok).toBe(true);
    expect(await create({ name: "J", contact: "juan@mail.com" })).toEqual({ ok: false, error: "invalid_name" });
    expect(await create({ name: "Juan", contact: "hola" })).toEqual({ ok: false, error: "invalid_contact" });
  });

  it("resolver la marca como resuelta; las pendientes van primero", async () => {
    const list = await db.withTenant(tenantId, (tx) => listWithdrawalRequests(tx));
    const first = list[list.length - 1]!;
    expect((await db.withTenant(tenantId, (tx) => resolveWithdrawalRequest(tx, first.id))).ok).toBe(true);
    const after = await db.withTenant(tenantId, (tx) => listWithdrawalRequests(tx));
    expect(after[after.length - 1]).toMatchObject({ id: first.id, status: "resuelta" });
    expect(after[after.length - 1]!.resolvedAt).not.toBeNull();
    expect(after[0]!.status).toBe("pendiente");
  });

  it("aislado por tenant", async () => {
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('otro','Otro') returning id");
    expect(await db.withTenant(t!.id, (tx) => listWithdrawalRequests(tx))).toEqual([]);
  });
});
