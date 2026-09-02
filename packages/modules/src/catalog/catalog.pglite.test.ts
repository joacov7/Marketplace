import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice, getVariantWithPrice, listCatalog, listCatalogAdmin, setProductImageByVariant, createCategory, listCategories, setProductCategoryByVariant, updateCategory, deleteCategory } from "./catalog.js";
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

  it("guarda la foto del producto al crearlo y la expone en catálogo y panel", async () => {
    const url = "https://cdn.example.com/pipeta.jpg";
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "pipeta", name: "Pipeta", imageUrl: url });
      const v = await addVariant(tx, { tenantId, productId, sku: "PIP-1", name: "Único" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 800_000n });
      return v.variantId;
    });
    const list = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list.find((v) => v.variantId === variantId)?.imageUrl).toBe(url);
    const admin = await db.withTenant(tenantId, (tx) => listCatalogAdmin(tx, merchantId));
    expect(admin.find((r) => r.variantId === variantId)?.imageUrl).toBe(url);
  });

  it("setProductImageByVariant actualiza la foto de un producto existente", async () => {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "correa", name: "Correa" });
      const v = await addVariant(tx, { tenantId, productId, sku: "COR-1", name: "Único" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 300_000n });
      return v.variantId;
    });
    await db.withTenant(tenantId, (tx) => setProductImageByVariant(tx, { tenantId, variantId, imageUrl: "https://cdn.example.com/correa.png" }));
    const list = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list.find((v) => v.variantId === variantId)?.imageUrl).toBe("https://cdn.example.com/correa.png");
    // Limpiar la foto (null).
    await db.withTenant(tenantId, (tx) => setProductImageByVariant(tx, { tenantId, variantId, imageUrl: null }));
    const list2 = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list2.find((v) => v.variantId === variantId)?.imageUrl).toBeNull();
  });

  it("categorías: crea, asigna a un producto y las expone en catálogo y panel", async () => {
    const { categoryId, variantId } = await db.withTenant(tenantId, async (tx) => {
      const { categoryId } = await createCategory(tx, { tenantId, merchantId, name: "Alimentos para Perros", position: 1 });
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "dogchow", name: "Dog Chow", categoryId });
      const v = await addVariant(tx, { tenantId, productId, sku: "DC-15", name: "15kg" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 1_200_000n });
      return { categoryId, variantId: v.variantId };
    });

    const catList = await db.withTenant(tenantId, (tx) => listCategories(tx, merchantId));
    expect(catList.some((c) => c.name === "Alimentos para Perros")).toBe(true);

    const list = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    const row = list.find((v) => v.variantId === variantId);
    expect(row?.categoryId).toBe(categoryId);
    expect(row?.categoryName).toBe("Alimentos para Perros");

    const admin = await db.withTenant(tenantId, (tx) => listCatalogAdmin(tx, merchantId));
    expect(admin.find((r) => r.variantId === variantId)?.categoryName).toBe("Alimentos para Perros");

    // Reasignar a "Sin categoría" (null).
    await db.withTenant(tenantId, (tx) => setProductCategoryByVariant(tx, { tenantId, variantId, categoryId: null }));
    const list2 = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list2.find((v) => v.variantId === variantId)?.categoryId).toBeNull();
  });

  it("renombra y borra categorías; borrar deja los productos sin categoría", async () => {
    const { categoryId, variantId } = await db.withTenant(tenantId, async (tx) => {
      const { categoryId } = await createCategory(tx, { tenantId, merchantId, name: "Higiene" });
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "shampoo-x", name: "Shampoo", categoryId });
      const v = await addVariant(tx, { tenantId, productId, sku: "SH-1", name: "500ml" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 600_000n });
      return { categoryId, variantId: v.variantId };
    });
    // Renombrar.
    await db.withTenant(tenantId, (tx) => updateCategory(tx, { categoryId, name: "Higiene y Cuidado" }));
    const cats = await db.withTenant(tenantId, (tx) => listCategories(tx, merchantId));
    expect(cats.find((c) => c.id === categoryId)?.name).toBe("Higiene y Cuidado");
    // Borrar → el producto queda sin categoría, la categoría desaparece.
    await db.withTenant(tenantId, (tx) => deleteCategory(tx, categoryId));
    const cats2 = await db.withTenant(tenantId, (tx) => listCategories(tx, merchantId));
    expect(cats2.some((c) => c.id === categoryId)).toBe(false);
    const list = await db.withTenant(tenantId, (tx) => listCatalog(tx, merchantId));
    expect(list.find((v) => v.variantId === variantId)?.categoryId).toBeNull();
  });
});
