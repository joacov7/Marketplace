import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../db/pglite.testsupport.js";
import type { TenantAwareDb } from "../db/port.js";
import { createTenant } from "./provisioning.js";
import { PET_SHOP_TEMPLATE } from "./templates.js";
import { createMerchant, listMerchants } from "./merchants.js";
import { resolveConfigValue } from "../config/repository.js";

/**
 * Criterio de aceptación: "crear un segundo tenant sin tocar código" y "datos/config
 * aislados por tenant". Todo por datos (plantilla), cero código por tenant.
 */
describe("Provisioning de tenant por plantilla (White Label, F1)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("crea un tenant Pet Shop y siembra la config de la plantilla", async () => {
    const res = await createTenant(db, {
      slug: "gualeguay-pets",
      name: "Pet Shop Gualeguay",
      template: PET_SHOP_TEMPLATE,
      region: { slug: "gualeguay", name: "Gualeguay" },
      actor: "super-admin",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const comm = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: res.value.tenantId });
    expect(comm.value).toBe(700);
    const maxSellers = await resolveConfigValue<number>(db, "orders.maxSellersPerOrder", { tenantId: res.value.tenantId });
    expect(maxSellers.value).toBe(1); // V1: 1 pedido = 1 comercio, por config
    const vertical = await resolveConfigValue<string>(db, "tenant.vertical", { tenantId: res.value.tenantId });
    expect(vertical.value).toBe("pet_shop");
  });

  it("un SEGUNDO tenant se crea sin código, con branding y comisión propios, aislado del primero", async () => {
    const t1 = await createTenant(db, {
      slug: "t-uno",
      name: "Uno",
      template: PET_SHOP_TEMPLATE,
      region: { slug: "r1", name: "R1" },
      actor: "super-admin",
    });
    const t2 = await createTenant(db, {
      slug: "t-dos",
      name: "Dos",
      template: PET_SHOP_TEMPLATE,
      region: { slug: "r2", name: "R2" },
      actor: "super-admin",
      configOverrides: [
        { key: "commission.rateBps", value: 500, reason: "promo lanzamiento" },
        { key: "branding.displayName", value: "Tienda Dos" },
      ],
    });
    expect(t1.ok && t2.ok).toBe(true);
    if (!t1.ok || !t2.ok) return;

    // La comisión override del tenant 2 NO afecta al tenant 1.
    const c1 = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: t1.value.tenantId });
    const c2 = await resolveConfigValue<number>(db, "commission.rateBps", { tenantId: t2.value.tenantId });
    expect(c1.value).toBe(700);
    expect(c2.value).toBe(500);

    const b2 = await resolveConfigValue<string>(db, "branding.displayName", { tenantId: t2.value.tenantId });
    expect(b2.value).toBe("Tienda Dos");
  });

  it("alta de comercios dentro de un tenant (marketplace) — aislados por tenant", async () => {
    const t = await createTenant(db, { slug: "mkt", name: "Mkt", template: PET_SHOP_TEMPLATE, region: { slug: "r", name: "R" }, actor: "s" });
    if (!t.ok) throw new Error(t.error);
    const tenantId = t.value.tenantId;

    const m1 = await createMerchant(db, { tenantId, slug: "petshop", name: "Pet Shop" });
    const m2 = await createMerchant(db, { tenantId, slug: "veterinaria", name: "Veterinaria" });
    expect(m1.ok && m2.ok).toBe(true);

    const merchants = await db.withTenant(tenantId, (tx) => listMerchants(tx));
    expect(merchants.map((m) => m.slug).sort()).toEqual(["petshop", "veterinaria"]);

    // slug duplicado dentro del tenant → error
    const dup = await createMerchant(db, { tenantId, slug: "petshop", name: "Otro" });
    expect(dup.ok).toBe(false);
  });

  it("rollback atómico: slug duplicado no deja tenant a medias", async () => {
    await createTenant(db, { slug: "dup", name: "A", template: PET_SHOP_TEMPLATE, region: { slug: "ra", name: "RA" }, actor: "s" });
    const again = await createTenant(db, { slug: "dup", name: "B", template: PET_SHOP_TEMPLATE, region: { slug: "rb", name: "RB" }, actor: "s" });
    expect(again.ok).toBe(false);
    const count = await db.tx((tx) => tx.query<{ n: string }>("select count(*)::text as n from tenants where slug = 'dup'"));
    expect(count[0]!.n).toBe("1");
  });
});
