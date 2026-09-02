import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createAdoption, listAdoptions, listAdoptionsAdmin, updateAdoption, deleteAdoption } from "./adoptions.js";

describe("Adopciones — publicaciones de mascotas (RLS)", () => {
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

  it("publica, lista solo disponibles, marca adoptado y borra", async () => {
    const { id } = await db.withTenant(tenantId, (tx) => createAdoption(tx, { tenantId, name: "Rocky", species: "perro", age: "2 años", description: "Cariñoso", contactWhatsapp: "5493444111222" }));
    await db.withTenant(tenantId, (tx) => createAdoption(tx, { tenantId, name: "Michi", species: "gato" }));

    let pub = await db.withTenant(tenantId, (tx) => listAdoptions(tx));
    expect(pub.length).toBe(2);
    expect(pub.some((a) => a.name === "Rocky" && a.species === "perro")).toBe(true);

    // Marcar Rocky como adoptado → sale de la vista pública, sigue en la admin.
    await db.withTenant(tenantId, (tx) => updateAdoption(tx, { id, status: "adopted" }));
    pub = await db.withTenant(tenantId, (tx) => listAdoptions(tx));
    expect(pub.some((a) => a.id === id)).toBe(false);
    const admin = await db.withTenant(tenantId, (tx) => listAdoptionsAdmin(tx));
    expect(admin.find((a) => a.id === id)?.status).toBe("adopted");

    // Borrar.
    await db.withTenant(tenantId, (tx) => deleteAdoption(tx, id));
    const admin2 = await db.withTenant(tenantId, (tx) => listAdoptionsAdmin(tx));
    expect(admin2.some((a) => a.id === id)).toBe(false);
  });
});
