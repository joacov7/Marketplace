import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../db/pglite.testsupport.js";
import type { TenantAwareDb } from "../db/port.js";
import { setConfigValue, resolveConfigValue } from "./repository.js";

describe("Config Repository — persistencia + resolución end-to-end", () => {
  let pg: PGlite;
  let db: TenantAwareDb;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("cae al default del registro cuando no hay valores", async () => {
    const r = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: "t1" });
    expect(r.value).toBe(700); // 7%
    expect(r.source).toBe("default");
  });

  it("un override de merchant vence al de tenant", async () => {
    await setConfigValue(db, { key: "commission.rateBps", scopeType: "tenant", scopeId: "t1", value: 800, actor: "a", reason: "acuerdo tenant" });
    await setConfigValue(db, { key: "commission.rateBps", scopeType: "merchant", scopeId: "m1", value: 600, actor: "a", reason: "merchant estrella" });
    const r = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: "t1", merchantId: "m1" });
    expect(r.value).toBe(600);
    expect(r.source).toBe("merchant");
  });

  it("versiona: un segundo set incrementa la versión y gana el nuevo valor", async () => {
    await setConfigValue(db, { key: "commission.rateBps", scopeType: "tenant", scopeId: "t2", value: 800, actor: "a", reason: "v1" });
    const res2 = await setConfigValue(db, { key: "commission.rateBps", scopeType: "tenant", scopeId: "t2", value: 750, actor: "a", reason: "v2" });
    expect(res2.ok && res2.value.version).toBe(2);
    const r = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: "t2" });
    expect(r.value).toBe(750);
  });

  it("valida contra el JSON Schema: rechaza fuera de rango", async () => {
    const res = await setConfigValue(db, { key: "commission.rateBps", scopeType: "tenant", scopeId: "t3", value: 99999, actor: "a", reason: "x" });
    expect(res.ok).toBe(false);
  });

  it("exige reason en claves sensibles (dinero)", async () => {
    const res = await setConfigValue(db, { key: "commission.rateBps", scopeType: "tenant", scopeId: "t4", value: 700, actor: "a" });
    expect(res.ok).toBe(false);
  });

  it("rechaza claves desconocidas", async () => {
    const res = await setConfigValue(db, { key: "no.existe", scopeType: "tenant", scopeId: "t5", value: 1, actor: "a" });
    expect(res.ok).toBe(false);
  });
});
