import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { setConfigValue } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder } from "../orders/orders.js";
import { createDelivery, transitionDelivery, getDelivery, quoteDelivery, listZones, createZone, updateZone, deleteZone, zoneChargeByName, haversineKm, checkDeliveryRadius } from "./delivery.js";

describe("Delivery — costeo, ciclo de entrega, subsidio", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  async function orderWithSeller(unitPrice: bigint): Promise<{ sellerOrderId: string; totalMinor: bigint }> {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + Math.random(), name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S" + Math.random(), name: "S" });
      await setStock(tx, { tenantId, variantId, available: 10 });
      return variantId;
    });
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: unitPrice }] }],
    });
    if (!created.ok) throw new Error(created.error);
    return { sellerOrderId: created.value.sellerOrderIds[0]!, totalMinor: created.value.totalMinor };
  }

  it("cotiza con defaults de config: cliente $1.500, cadete $2.500, subsidio $1.000", async () => {
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 3_000_000n }));
    expect(q.customerChargeMinor).toBe(150_000n);
    expect(q.cadeteCostMinor).toBe(250_000n);
    expect(q.subsidyMinor).toBe(100_000n);
    expect(q.subsidySource).toBe("platform");
  });

  it("delivery gratis sobre el umbral ($50.000): cliente $0, subsidio total", async () => {
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 6_000_000n }));
    expect(q.customerChargeMinor).toBe(0n);
    expect(q.subsidyMinor).toBe(250_000n);
  });

  it("crea la entrega de un seller_order y recorre el ciclo hasta delivered", async () => {
    const { sellerOrderId, totalMinor } = await orderWithSeller(3_000_000n);
    const created = await createDelivery(db, { tenantId, sellerOrderId, orderTotalMinor: totalMinor, etaMinutes: 30 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.deliveryId;

    for (const to of ["assigned", "picked_up", "in_transit", "delivered"] as const) {
      const r = await transitionDelivery(db, { tenantId, deliveryId: id, to, ...(to === "assigned" ? {} : {}) });
      expect(r.ok).toBe(true);
    }
    const d = await db.withTenant(tenantId, (tx) => getDelivery(tx, id));
    expect(d?.status).toBe("delivered");
    expect(d?.customerChargeMinor).toBe(150_000n);
  });

  it("rechaza transiciones inválidas (pending → delivered)", async () => {
    const { sellerOrderId, totalMinor } = await orderWithSeller(1_000_000n);
    const created = await createDelivery(db, { tenantId, sellerOrderId, orderTotalMinor: totalMinor });
    if (!created.ok) throw new Error(created.error);
    const bad = await transitionDelivery(db, { tenantId, deliveryId: created.value.deliveryId, to: "delivered" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid_transition/);
  });

  it("una tarifa por zona pisa los defaults de config", async () => {
    const zoneId = await db.withTenant(tenantId, async (tx) => {
      const [z] = await tx.query<{ id: string }>(
        "insert into delivery_zones (tenant_id, name) values ($1,'centro') returning id",
        [tenantId],
      );
      await tx.query(
        "insert into delivery_rates (tenant_id, zone_id, cadete_cost_minor, customer_charge_minor, subsidy_source) values ($1,$2,300000,200000,'merchant')",
        [tenantId, z!.id],
      );
      return z!.id;
    });
    const q = await db.withTenant(tenantId, (tx) => quoteDelivery(tx, { tenantId, orderTotalMinor: 3_000_000n, zoneId }));
    expect(q.cadeteCostMinor).toBe(300_000n);
    expect(q.customerChargeMinor).toBe(200_000n);
    expect(q.subsidySource).toBe("merchant");
  });

  it("Eslabón 3: zonas de reparto — CRUD + matcheo por nombre para el checkout", async () => {
    const { id } = await db.withTenant(tenantId, (tx) =>
      createZone(tx, { tenantId, name: "Barrio Norte", customerChargeMinor: 150_000n, etaMinutes: 30 }),
    );
    await db.withTenant(tenantId, (tx) => createZone(tx, { tenantId, name: "Munilla", customerChargeMinor: 250_000n }));

    let zones = await db.withTenant(tenantId, (tx) => listZones(tx));
    const norte = zones.find((z) => z.name === "Barrio Norte")!;
    expect(norte.customerChargeMinor).toBe(150_000n);
    expect(norte.etaMinutes).toBe(30);

    // Matcheo por nombre (case-insensitive) → tarifa que usa el checkout.
    const match = await db.withTenant(tenantId, (tx) => zoneChargeByName(tx, "barrio norte"));
    expect(match?.customerChargeMinor).toBe(150_000n);
    expect(await db.withTenant(tenantId, (tx) => zoneChargeByName(tx, "Barrio inexistente"))).toBeNull();

    // Editar costo + ETA.
    await db.withTenant(tenantId, (tx) => updateZone(tx, { id, customerChargeMinor: 180_000n, etaMinutes: 45 }));
    zones = await db.withTenant(tenantId, (tx) => listZones(tx));
    const upd = zones.find((z) => z.id === id)!;
    expect(upd.customerChargeMinor).toBe(180_000n);
    expect(upd.etaMinutes).toBe(45);

    // Eliminar.
    await db.withTenant(tenantId, (tx) => deleteZone(tx, id));
    zones = await db.withTenant(tenantId, (tx) => listZones(tx));
    expect(zones.some((z) => z.id === id)).toBe(false);
  });

  it("haversineKm calcula distancias razonables (0 en el mismo punto, ~157 km por grado)", () => {
    expect(haversineKm(-33.14, -59.3, -33.14, -59.3)).toBe(0);
    // ~1° de latitud ≈ 111 km.
    expect(haversineKm(0, 0, 1, 0)).toBeGreaterThan(110);
    expect(haversineKm(0, 0, 1, 0)).toBeLessThan(112);
  });

  it("radio de reparto: desactivado por defecto → no bloquea ninguna ubicación", async () => {
    const r = await db.withTenant(tenantId, (tx) => checkDeliveryRadius(tx, { tenantId, lat: -33.5, lng: -59.9 }));
    expect(r.enabled).toBe(false);
    expect(r.withinRadius).toBe(true);
    expect(r.distanceKm).toBeNull();
  });

  it("radio de reparto: con centro + radio, acepta dentro y rechaza fuera; sin punto no bloquea", async () => {
    const center = { lat: -33.146, lng: -59.309 }; // local (ej. Gualeguay)
    for (const [key, value] of [
      ["delivery.radiusKm", 8],
      ["delivery.centerLat", center.lat],
      ["delivery.centerLng", center.lng],
    ] as const) {
      const set = await setConfigValue(db, { key, scopeType: "tenant", scopeId: tenantId, value, actor: "test", reason: "radio" });
      expect(set.ok).toBe(true);
    }

    // Punto a ~1 km (mismo barrio) → dentro.
    const near = await db.withTenant(tenantId, (tx) => checkDeliveryRadius(tx, { tenantId, lat: -33.152, lng: -59.312 }));
    expect(near.enabled).toBe(true);
    expect(near.withinRadius).toBe(true);
    expect(near.distanceKm).not.toBeNull();
    expect(near.distanceKm!).toBeLessThan(8);

    // Punto lejano (~40 km) → fuera.
    const far = await db.withTenant(tenantId, (tx) => checkDeliveryRadius(tx, { tenantId, lat: -33.5, lng: -59.6 }));
    expect(far.enabled).toBe(true);
    expect(far.withinRadius).toBe(false);
    expect(far.distanceKm!).toBeGreaterThan(8);

    // Filtro activo pero sin ubicación → no bloquea (ubicación es opcional).
    const noPoint = await db.withTenant(tenantId, (tx) => checkDeliveryRadius(tx, { tenantId }));
    expect(noPoint.enabled).toBe(true);
    expect(noPoint.withinRadius).toBe(true);
    expect(noPoint.distanceKm).toBeNull();
  });
});
