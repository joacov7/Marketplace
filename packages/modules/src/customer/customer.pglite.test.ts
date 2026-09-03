import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import {
  normalizePhone,
  findCustomerByPhone,
  findOrCreateCustomerByPhone,
  ensureCustomerForUser,
  getCustomer,
} from "./customer.js";
import { createPet, listPets } from "../pets/pets.js";

describe("Customer — ficha por teléfono (Eslabón 1)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let tenantB: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId } = await seedTenantMerchant(db));
    // Segundo tenant para probar aislamiento.
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('t2','T2') returning id");
    tenantB = t!.id;
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("normalizePhone deja solo dígitos (mismo número → misma llave)", () => {
    expect(normalizePhone("+54 2447 15-40-40")).toBe("542447154040");
    expect(normalizePhone("(0244) 715 4040")).toBe("02447154040");
    expect(normalizePhone("  ")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });

  it("crea un cliente por teléfono y lo reutiliza sin duplicar", async () => {
    const a = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "2447 40-40-40", name: "Joaco" }),
    );
    expect(a.created).toBe(true);
    expect(a.customer.name).toBe("Joaco");

    // Mismo número escrito distinto → MISMA ficha (no duplica).
    const b = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "244740 4040" }),
    );
    expect(b.created).toBe(false);
    expect(b.customerId).toBe(a.customerId);

    const found = await db.withTenant(tenantId, (tx) => findCustomerByPhone(tx, "24474040-40"));
    expect(found?.id).toBe(a.customerId);

    // Solo hay una fila para ese teléfono en el tenant (guardado normalizado = solo dígitos).
    const count = await db.withTenant(tenantId, (tx) =>
      tx.query<{ n: string }>("select count(*)::text n from customers where phone = $1", ["2447404040"]),
    );
    expect(Number(count[0]!.n)).toBe(1);
  });

  it("completa el nombre si faltaba, sin pisar uno existente", async () => {
    // Alta sin nombre.
    const c = await db.withTenant(tenantId, (tx) => findOrCreateCustomerByPhone(tx, { tenantId, phone: "111-222-333" }));
    expect(c.customer.name).toBeNull();
    // Segunda compra trae el nombre → se completa.
    await db.withTenant(tenantId, (tx) => findOrCreateCustomerByPhone(tx, { tenantId, phone: "111222333", name: "Ana" }));
    let cust = await db.withTenant(tenantId, (tx) => getCustomer(tx, c.customerId));
    expect(cust?.name).toBe("Ana");
    // Tercera con otro nombre NO lo pisa.
    await db.withTenant(tenantId, (tx) => findOrCreateCustomerByPhone(tx, { tenantId, phone: "111222333", name: "Otro" }));
    cust = await db.withTenant(tenantId, (tx) => getCustomer(tx, c.customerId));
    expect(cust?.name).toBe("Ana");
  });

  it("mismo teléfono en tenants distintos = clientes distintos (aislamiento)", async () => {
    const inA = await db.withTenant(tenantId, (tx) => findOrCreateCustomerByPhone(tx, { tenantId, phone: "999000" }));
    const inB = await db.withTenant(tenantB, (tx) => findOrCreateCustomerByPhone(tx, { tenantId: tenantB, phone: "999000" }));
    expect(inA.customerId).not.toBe(inB.customerId);
    // El tenant A no ve al cliente del tenant B.
    const seenFromA = await db.withTenant(tenantId, (tx) => getCustomer(tx, inB.customerId));
    expect(seenFromA).toBeNull();
  });

  it("ensureCustomerForUser es determinista (id = userId) e idempotente", async () => {
    const userId = "77777777-7777-7777-7777-777777777777";
    const r1 = await db.withTenant(tenantId, (tx) => ensureCustomerForUser(tx, { tenantId, userId, name: "Regis" }));
    expect(r1.customerId).toBe(userId);
    // Idempotente: segunda llamada no duplica ni cambia el id.
    const r2 = await db.withTenant(tenantId, (tx) => ensureCustomerForUser(tx, { tenantId, userId }));
    expect(r2.customerId).toBe(userId);
    const count = await db.withTenant(tenantId, (tx) =>
      tx.query<{ n: string }>("select count(*)::text n from customers where id = $1", [userId]),
    );
    expect(Number(count[0]!.n)).toBe(1);
  });

  it("las mascotas cuelgan de la ficha del cliente (teléfono)", async () => {
    const { customerId } = await db.withTenant(tenantId, (tx) =>
      findOrCreateCustomerByPhone(tx, { tenantId, phone: "5551234", name: "Dueño de Bruno" }),
    );
    await db.withTenant(tenantId, (tx) => createPet(tx, { tenantId, customerId, name: "Bruno", species: "perro" }));
    const pets = await db.withTenant(tenantId, (tx) => listPets(tx, customerId));
    expect(pets.map((p) => p.name)).toContain("Bruno");
  });
});
