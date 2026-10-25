import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { setConfigValue, type TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { findOrCreateCustomerByPhone } from "../customer/customer.js";
import { createOrder, confirmOrder, completeOrder } from "../orders/orders.js";
import {
  addLoyaltyPoints,
  listRewards,
  loyaltyBalance,
  loyaltyHistory,
  orderPointsEarned,
  pointsForSpend,
  redeemReward,
  saveReward,
  topLoyaltyCustomers,
} from "./loyalty.js";

describe("club de puntos", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let variantId: string;
  let customerId: string;

  const setCfg = (key: string, value: unknown) =>
    db.withTenant(tenantId, (tx) => setConfigValue(tx, { key, scopeType: "tenant", scopeId: tenantId, value, actor: "test", reason: "test" }));
  const balance = () => db.withTenant(tenantId, (tx) => loyaltyBalance(tx, customerId));
  // Pedido entregado: $2.500 en productos (2 × $1.250) + $1.500 de envío.
  const deliveredOrder = async (cid: string | null = customerId) => {
    const r = await createOrder(db, {
      tenantId,
      ...(cid ? { customerId: cid } : {}),
      paymentMethod: "efectivo",
      deliveryChargeMinor: 150000n,
      sellers: [{ merchantId, items: [{ variantId, qty: 2, unitPriceMinor: 125000n }] }],
    });
    if (!r.ok) throw new Error(r.error);
    expect((await confirmOrder(db, tenantId, r.value.orderId)).ok).toBe(true);
    expect((await completeOrder(db, tenantId, r.value.orderId)).ok).toBe(true);
    return r.value.orderId;
  };

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    ({ variantId, customerId } = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "a", name: "A" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "A1", name: "A" });
      await setStock(tx, { tenantId, variantId, available: 500 });
      const { customerId } = await findOrCreateCustomerByPhone(tx, { tenantId, phone: "3444 111 222", name: "Ana" });
      return { variantId, customerId };
    }));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("puntos por gasto: redondea hacia abajo", () => {
    expect(pointsForSpend(250000n, 100000n)).toBe(2);
    expect(pointsForSpend(99999n, 100000n)).toBe(0);
    expect(pointsForSpend(0n, 100000n)).toBe(0);
  });

  it("con el club apagado (default) un pedido entregado no suma", async () => {
    await deliveredOrder();
    expect(await balance()).toBe(0);
  });

  it("encendido: suma por lo gastado en productos (sin envío), una sola vez por pedido", async () => {
    expect((await setCfg("features.loyalty", true)).ok).toBe(true);
    const orderId = await deliveredOrder();
    expect(await balance()).toBe(2); // $2.500 → 2 puntos; el envío no cuenta
    expect(await db.withTenant(tenantId, (tx) => orderPointsEarned(tx, orderId))).toBe(2);
    // Completar de nuevo es idempotente: no vuelve a sumar.
    expect((await completeOrder(db, tenantId, orderId)).ok).toBe(true);
    expect(await balance()).toBe(2);
  });

  it("la regla es config: 1 punto cada $500 → el doble", async () => {
    expect((await setCfg("loyalty.spendPerPointMinor", 50000)).ok).toBe(true);
    await deliveredOrder();
    expect(await balance()).toBe(2 + 5);
    await setCfg("loyalty.spendPerPointMinor", 100000);
  });

  it("pedido sin cliente identificado: no suma ni falla", async () => {
    const orderId = await deliveredOrder(null);
    expect(await db.withTenant(tenantId, (tx) => orderPointsEarned(tx, orderId))).toBe(0);
  });

  it("compra en el local y ajuste manual (con motivo, nunca negativo)", async () => {
    const store = await db.withTenant(tenantId, (tx) => addLoyaltyPoints(tx, { tenantId, customerId, kind: "store", amountMinor: 1000000n }));
    expect(store).toEqual({ ok: true, value: { points: 10, balance: 17 } });
    const noNote = await db.withTenant(tenantId, (tx) => addLoyaltyPoints(tx, { tenantId, customerId, kind: "adjust", points: 3 }));
    expect(noNote).toEqual({ ok: false, error: "note_required" });
    const tooMuch = await db.withTenant(tenantId, (tx) => addLoyaltyPoints(tx, { tenantId, customerId, kind: "adjust", points: -100, note: "error" }));
    expect(tooMuch).toEqual({ ok: false, error: "insufficient_points" });
    const adj = await db.withTenant(tenantId, (tx) => addLoyaltyPoints(tx, { tenantId, customerId, kind: "adjust", points: 3, note: "cumpleaños" }));
    expect(adj.ok && adj.value.balance).toBe(20);
  });

  it("canje: descuenta el costo; sin saldo o premio inactivo, no", async () => {
    const big = await db.withTenant(tenantId, (tx) => saveReward(tx, { tenantId, name: "Bolsa 15 kg", pointsCost: 500 }));
    const small = await db.withTenant(tenantId, (tx) => saveReward(tx, { tenantId, name: "Piedras sanitarias", pointsCost: 15 }));
    if (!big.ok || !small.ok) throw new Error("reward");
    const noFunds = await db.withTenant(tenantId, (tx) => redeemReward(tx, { tenantId, customerId, rewardId: big.value.id }));
    expect(noFunds).toEqual({ ok: false, error: "insufficient_points" });
    const r = await db.withTenant(tenantId, (tx) => redeemReward(tx, { tenantId, customerId, rewardId: small.value.id }));
    expect(r).toEqual({ ok: true, value: { points: -15, balance: 5, reward: "Piedras sanitarias" } });
    expect(await balance()).toBe(5);

    await db.withTenant(tenantId, (tx) => saveReward(tx, { tenantId, id: small.value.id, name: "Piedras sanitarias", pointsCost: 1, active: false }));
    const inactive = await db.withTenant(tenantId, (tx) => redeemReward(tx, { tenantId, customerId, rewardId: small.value.id }));
    expect(inactive).toEqual({ ok: false, error: "reward_not_found" });
    expect((await db.withTenant(tenantId, (tx) => listRewards(tx, { activeOnly: true }))).map((x) => x.name)).toEqual(["Bolsa 15 kg"]);
  });

  it("historial y ranking", async () => {
    const h = await db.withTenant(tenantId, (tx) => loyaltyHistory(tx, customerId));
    expect(h[0]).toMatchObject({ kind: "redeem", points: -15, rewardName: "Piedras sanitarias" });
    expect(h.map((m) => m.kind).sort()).toEqual(["adjust", "earn", "earn", "redeem", "store"]);
    const top = await db.withTenant(tenantId, (tx) => topLoyaltyCustomers(tx));
    expect(top).toEqual([{ customerId, name: "Ana", phone: "3444111222", balance: 5 }]);
  });

  it("aislado por tenant: otro comercio no ve los puntos", async () => {
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('otro','Otro') returning id");
    const seen = await db.withTenant(t!.id, (tx) => loyaltyBalance(tx, customerId));
    expect(seen).toBe(0);
  });
});
