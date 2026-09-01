import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant, setPrice } from "../catalog/catalog.js";
import { setStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder } from "../orders/orders.js";
import { runCustomerAgent } from "./agent.js";
import { AiBudgetGuard } from "./enforcement.js";

describe("Customer Shopping Agent — busca, recomienda, prepara (propose-only)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  let alimentoVariant: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
    await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "alimento-perro", name: "Alimento Perro Adulto" });
      const v = await addVariant(tx, { tenantId, productId, sku: "AP-15KG", name: "15kg" });
      await setPrice(tx, { tenantId, variantId: v.variantId, amountMinor: 3_000_000n });
      await setStock(tx, { tenantId, variantId: v.variantId, available: 10 });
      alimentoVariant = v.variantId;
      const { productId: p2 } = await createProduct(tx, { tenantId, merchantId, slug: "arena-gato", name: "Arena Gato Aglomerante" });
      const v2 = await addVariant(tx, { tenantId, productId: p2, sku: "AG-10L", name: "10L" });
      await setPrice(tx, { tenantId, variantId: v2.variantId, amountMinor: 800_000n });
      await setStock(tx, { tenantId, variantId: v2.variantId, available: 5 });
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("busca por la consulta y PREPARA un carrito (sin comprar)", async () => {
    const r = await runCustomerAgent(db, { tenantId, message: "necesito comida para mi perro" });
    expect(r.requiresHumanConfirmation).toBe(true);
    expect(r.usedTools).toContain("buscar_producto");
    expect(r.usedTools).toContain("armar_carrito");
    expect(r.proposedCart).not.toBeNull();
    expect(r.proposedCart!.items[0]!.variantId).toBe(alimentoVariant);
    // propose-only: la respuesta no expone ningún orderId
    expect((r as Record<string, unknown>)["orderId"]).toBeUndefined();
  });

  it("el agente NO crea pedidos (propose-only): la cantidad de orders no cambia", async () => {
    const before = await db.withTenant(tenantId, (tx) => tx.query<{ n: string }>("select count(*)::text n from orders"));
    await runCustomerAgent(db, { tenantId, message: "arena para gato" });
    const after = await db.withTenant(tenantId, (tx) => tx.query<{ n: string }>("select count(*)::text n from orders"));
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("detecta recompra desde el historial del cliente", async () => {
    const customerId = "11111111-1111-1111-1111-111111111111";
    const created = await createOrder(db, {
      tenantId,
      customerId,
      sellers: [{ merchantId, items: [{ variantId: alimentoVariant, qty: 1, unitPriceMinor: 3_000_000n }] }],
    });
    if (!created.ok) throw new Error(created.error);
    await confirmOrder(db, tenantId, created.value.orderId);

    const r = await runCustomerAgent(db, { tenantId, customerId, message: "algo para mi mascota" });
    expect(r.usedTools).toContain("detectar_recompra");
    expect(r.proposedCart!.items.some((i) => i.variantId === alimentoVariant)).toBe(true);
  });

  it("respeta el presupuesto: si el ítem supera el tope, no lo incluye", async () => {
    const r = await runCustomerAgent(db, { tenantId, message: "comida perro", budgetMinor: 100_000n }); // $1.000 < $30.000
    expect(r.proposedCart).toBeNull(); // el único candidato no entra en el presupuesto
  });

  it("presupuesto de IA agotado → falla cerrado, sin usar tools", async () => {
    const r = await runCustomerAgent(db, { tenantId, message: "comida perro" }, { budget: new AiBudgetGuard(0n) });
    expect(r.proposedCart).toBeNull();
    expect(r.usedTools).toEqual([]);
    expect(r.reply).toMatch(/límite/i);
  });
});
