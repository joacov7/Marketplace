import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice, getVariantWithPrice, listCatalog, listCatalogAdmin } from "./catalog.js";
import { setStock } from "../inventory/inventory.js";

describe("Catálogo — productos, variantes, precios", () => {
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

  it("crea producto + variante + precio y lo lee con el precio actual", async () => {
    await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "alimento-perro", name: "Alimento Perro Adulto" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "AP-15KG", name: "15kg" });
      await setPrice(tx, { tenantId, variantId, amountMinor: 3_000_000n }); // $30.000
      const v = await getVariantWithPrice(tx, variantId);
      expect(v?.price?.amountMinor).toBe(3_000_000n);
      expect(v?.price?.currency).toBe("ARS");
    });
  });

  it("el precio actual es el último vigente (versionado por fecha)", async () => {
    await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "arena-gato", name: "Arena Gato" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "AG-10L", name: "10L" });
      await setPrice(tx, { tenantId, variantId, amountMinor: 1_000_000n, effectiveFrom: new Date("2025-01-01") });
      await setPrice(tx, { tenantId, variantId, amountMinor: 1_200_000n, effectiveFrom: new Date("2025-06-01") });
      const v = await getVariantWithPrice(tx, variantId, new Date("2025-07-01"));
      expect(v?.price?.amountMinor).toBe(1_200_000n); // el más reciente vigente
    });
  });

  it("listCatalog devuelve las variantes activas del merchant", async () => {
    const list = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((v) => v.sku.length > 0)).toBe(true);
  });

  it("listCatalogAdmin incluye stock y precio para el panel del comercio", async () => {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "collar", name: "Collar" });
      const v = await addVariant(tx, { tenantId, productId, sku: "COL-1", name: "M" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 500_000n });
      await setStock(tx, { tenantId, variantId: v.variantId, available: 7 });
      return v.variantId;
    });
    const admin = await db.withTenant(tenantId, (tx) => listCatalogAdmin(tx, merchantId));
    const row = admin.find((r) => r.variantId === variantId);
    expect(row?.available).toBe(7);
    expect(row?.priceMinor).toBe(500_000n);
    expect(row?.productName).toBe("Collar");
  });
});
