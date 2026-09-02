import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createPet, listPets, updatePet, deletePet, estimateConsumption, daysForBag, restingEnergy, factorFor } from "./pets.js";

describe("Pets — calculadora de consumo (RER/MER) y CRUD (RLS)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  const customerId = "55555555-5555-5555-5555-555555555555";

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("RER = 70 × peso^0.75 y MER aplica el factor", () => {
    // Perro de 10 kg: RER = 70 * 10^0.75 ≈ 393.6 kcal.
    expect(Math.round(restingEnergy(10))).toBe(394);
    const c = estimateConsumption({ weightKg: 10, factor: 1.4, kcalPerKg: 3800 });
    // MER ≈ 551 kcal; a 3800 kcal/kg (3.8 kcal/g) → ≈ 145 g/día.
    expect(c.merKcalPerDay).toBe(551);
    expect(c.gramsPerDay).toBe(145);
    expect(c.kgPerMonth).toBeCloseTo(4.4, 1);
    // Una bolsa de 15 kg dura ≈ 103 días.
    expect(daysForBag(15, c.gramsPerDay)).toBe(103);
  });

  it("factorFor cae al default y respeta overrides", () => {
    expect(factorFor("adulto_normal")).toBe(1.4);
    expect(factorFor("desconocido")).toBe(1.4);
    expect(factorFor("adulto_normal", { adulto_normal: 1.5 })).toBe(1.5);
  });

  it("CRUD de mascotas con contexto de tenant", async () => {
    const { id } = await db.withTenant(tenantId, (tx) => createPet(tx, { tenantId, customerId, name: "Firulais", species: "perro", breed: "Labrador", weightKg: 28, activity: "adulto_activo" }));
    let pets = await db.withTenant(tenantId, (tx) => listPets(tx, customerId));
    expect(pets.length).toBe(1);
    expect(pets[0]!.weightKg).toBe(28);

    await db.withTenant(tenantId, (tx) => updatePet(tx, { id, customerId, weightKg: 30 }));
    pets = await db.withTenant(tenantId, (tx) => listPets(tx, customerId));
    expect(pets[0]!.weightKg).toBe(30);

    await db.withTenant(tenantId, (tx) => deletePet(tx, id, customerId));
    pets = await db.withTenant(tenantId, (tx) => listPets(tx, customerId));
    expect(pets.length).toBe(0);
  });
});
