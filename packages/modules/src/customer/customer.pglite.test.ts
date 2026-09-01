import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { addAddress, listAddresses } from "./customer.js";

describe("Customer — libreta de direcciones (RLS)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  const customerId = "22222222-2222-2222-2222-222222222222";

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("guarda y lista direcciones del cliente", async () => {
    await db.withTenant(tenantId, (tx) => addAddress(tx, { tenantId, customerId, street: "San Martín 123", city: "Gualeguay", zone: "centro" }));
    await db.withTenant(tenantId, (tx) => addAddress(tx, { tenantId, customerId, street: "Belgrano 456", zone: "norte", notes: "timbre 2" }));
    const list = await db.withTenant(tenantId, (tx) => listAddresses(tx, customerId));
    expect(list.length).toBe(2);
    expect(list.some((a) => a.street === "San Martín 123" && a.zone === "centro")).toBe(true);
  });
});
