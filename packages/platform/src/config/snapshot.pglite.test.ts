import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "../db/port.js";
import { freshDb } from "../db/pglite.testsupport.js";
import { setConfigValue, resolveConfigValue, resolveConfigSnapshot } from "./repository.js";
import { CONFIG_KEYS } from "./registry.js";

describe("resolveConfigSnapshot — toda la config en una consulta", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
    const [a] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('a','A') returning id");
    const [b] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('b','B') returning id");
    tenantA = a!.id;
    tenantB = b!.id;
    const set = (scopeType: "platform" | "tenant", scopeId: string, key: string, value: unknown) =>
      setConfigValue(db, { key, scopeType, scopeId, value, actor: "test", reason: "test" });
    await set("platform", "platform", "delivery.customerChargeMinor", 120000);
    await set("tenant", tenantA, "delivery.customerChargeMinor", 150000);
    await set("tenant", tenantA, "delivery.customerChargeMinor", 175000); // versión nueva gana
    await set("tenant", tenantA, "features.aiAssistant", false);
    await set("tenant", tenantA, "branding.displayName", "Pet Shop A");
    await set("tenant", tenantB, "branding.displayName", "Pet Shop B"); // otro comercio: no se mezcla
    // Fila vieja doble-codificada (como dejaba postgres.js antes del arreglo de jsonb).
    await db.query(
      `insert into config_values (key, scope_type, scope_id, value, version, effective_from, actor)
       values ('features.adoptions','tenant',$1, to_jsonb('false'::text), 1, now() - interval '1 minute', 'legacy')`,
      [tenantA],
    );
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("para TODAS las claves del registro da lo mismo que resolveConfigValue (clave por clave)", async () => {
    for (const tenantId of [tenantA, tenantB]) {
      const snap = await resolveConfigSnapshot(db, { tenantId });
      for (const key of Object.keys(CONFIG_KEYS)) {
        const one = (await resolveConfigValue<unknown>(db, key, { tenantId })).value;
        expect(snap.get(key), `${key} @ ${tenantId === tenantA ? "A" : "B"}`).toEqual(one);
      }
    }
  });

  it("aplica herencia, versión, tipo y aislamiento entre comercios", async () => {
    const a = await resolveConfigSnapshot(db, { tenantId: tenantA });
    const b = await resolveConfigSnapshot(db, { tenantId: tenantB });
    expect(a.get("delivery.customerChargeMinor")).toBe(175000);
    expect(b.get("delivery.customerChargeMinor")).toBe(120000); // hereda de plataforma
    expect(a.get("features.aiAssistant")).toBe(false);
    expect(a.get("features.adoptions")).toBe(false); // fila vieja convertida
    expect(a.get("branding.displayName")).toBe("Pet Shop A");
    expect(b.get("branding.displayName")).toBe("Pet Shop B");
  });
});
