import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice } from "./catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createCombo, setComboItems, updateCombo, deleteCombo, listCombosAdmin, listCombosStore } from "./combos.js";

describe("Combos / Cajas (precio suma + stock, RLS)", () => {
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

  async function variant(name: string, priceMinor: bigint, stock: number): Promise<string> {
    return db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "c-" + Math.random(), name });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "C" + Math.random(), name: "Único" });
      await setPrice(tx, { tenantId, variantId, amountMinor: priceMinor, currency: "ARS" });
      await setStock(tx, { tenantId, variantId, available: stock });
      return variantId;
    });
  }

  it("crea la caja, calcula precio = suma de ítems y marca stock; ocultar la saca de la tienda", async () => {
    const lavandina = await variant("Lavandina", 1_000_000n, 100); // $10.000
    const detergente = await variant("Detergente", 500_000n, 100); // $5.000

    const { comboId } = await db.withTenant(tenantId, (tx) => createCombo(tx, { tenantId, merchantId, name: "Caja limpieza" }));
    await db.withTenant(tenantId, (tx) => setComboItems(tx, { tenantId, comboId, items: [{ variantId: lavandina, qty: 2 }, { variantId: detergente, qty: 1 }] }));

    const store = await db.withTenant(tenantId, (tx) => listCombosStore(tx, merchantId));
    expect(store.length).toBe(1);
    expect(store[0]!.priceMinor).toBe(2_500_000n); // 10.000×2 + 5.000
    expect(store[0]!.inStock).toBe(true);
    expect(store[0]!.items.length).toBe(2);

    const admin = await db.withTenant(tenantId, (tx) => listCombosAdmin(tx, merchantId));
    expect(admin.length).toBe(1);
    expect(admin[0]!.items.find((i) => i.variantId === lavandina)!.qty).toBe(2);

    // Ocultar (active=false) → no aparece en la tienda, sí en el panel.
    await db.withTenant(tenantId, (tx) => updateCombo(tx, { comboId, active: false }));
    expect((await db.withTenant(tenantId, (tx) => listCombosStore(tx, merchantId))).length).toBe(0);
    expect((await db.withTenant(tenantId, (tx) => listCombosAdmin(tx, merchantId))).length).toBe(1);

    await db.withTenant(tenantId, (tx) => deleteCombo(tx, comboId));
    expect((await db.withTenant(tenantId, (tx) => listCombosAdmin(tx, merchantId))).length).toBe(0);
  });

  it("marca la caja sin stock si un ítem no alcanza la cantidad", async () => {
    const escaso = await variant("Producto Escaso", 300_000n, 1); // stock 1
    const { comboId } = await db.withTenant(tenantId, (tx) => createCombo(tx, { tenantId, merchantId, name: "Caja escasa" }));
    await db.withTenant(tenantId, (tx) => setComboItems(tx, { tenantId, comboId, items: [{ variantId: escaso, qty: 5 }] }));

    const store = await db.withTenant(tenantId, (tx) => listCombosStore(tx, merchantId));
    const caja = store.find((c) => c.name === "Caja escasa")!;
    expect(caja.priceMinor).toBe(1_500_000n); // 3.000 × 5 (precio igual se calcula)
    expect(caja.inStock).toBe(false);
  });
});
