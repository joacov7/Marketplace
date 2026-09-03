import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock, getStock } from "../inventory/inventory.js";
import { createOrder, confirmOrder, getOrder } from "../orders/orders.js";
import { FakePaymentProvider } from "./provider.js";
import { createPaymentIntent, capturePayment, refundAllocation, settleCashOnDelivery } from "./payments.js";
import { accountBalance, ledgerIsBalanced } from "./ledger.js";

describe("Payments — captura, ledger de doble partida, idempotencia, refund parcial (#9)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;
  const provider = new FakePaymentProvider();

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  async function newOrder(): Promise<{ orderId: string }> {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + Math.random(), name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S" + Math.random(), name: "S" });
      await setStock(tx, { tenantId, variantId, available: 10 });
      return variantId;
    });
    const created = await createOrder(db, {
      tenantId,
      sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 3_000_000n }] }], // GMV $30.000
    });
    if (!created.ok) throw new Error("create falló: " + created.error);
    return { orderId: created.value.orderId };
  }

  it("captura: postea allocations + ledger balanceado, confirma pedido y consume stock", async () => {
    const { orderId } = await newOrder();
    const intent = await createPaymentIntent(db, provider, { tenantId, orderId, idempotencyKey: "k1" });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;

    const before = {
      merchant: await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId)),
      commission: await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission")),
      delivery: await db.withTenant(tenantId, (tx) => accountBalance(tx, "delivery")),
    };

    const cap = await capturePayment(db, { tenantId, providerEventId: "evt-1", providerRef: intent.value.providerRef });
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;
    expect(cap.value.alreadyProcessed).toBe(false);

    // GMV 3.000.000, comisión 7% = 210.000, merchant 2.790.000, delivery 150.000 (deltas)
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId))) - before.merchant).toBe(2_790_000n);
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission"))) - before.commission).toBe(210_000n);
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "delivery"))) - before.delivery).toBe(150_000n);
    expect(await db.withTenant(tenantId, (tx) => ledgerIsBalanced(tx))).toBe(true);

    const view = await db.withTenant(tenantId, (tx) => getOrder(tx, orderId));
    expect(view?.status).toBe("confirmed");
  });

  it("idempotencia: el MISMO webhook repetido no duplica pago ni ledger", async () => {
    const { orderId } = await newOrder();
    const intent = await createPaymentIntent(db, provider, { tenantId, orderId, idempotencyKey: "k2" });
    if (!intent.ok) return;

    const first = await capturePayment(db, { tenantId, providerEventId: "evt-dup", providerRef: intent.value.providerRef });
    const entriesAfterFirst = await db.withTenant(tenantId, (tx) =>
      tx.query<{ n: string }>("select count(*)::text n from ledger_entries where payment_id = $1", [
        (first as { value: { paymentId: string } }).value.paymentId,
      ]),
    );
    const second = await capturePayment(db, { tenantId, providerEventId: "evt-dup", providerRef: intent.value.providerRef });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.alreadyProcessed).toBe(true);
    const entriesAfterSecond = await db.withTenant(tenantId, (tx) =>
      tx.query<{ n: string }>("select count(*)::text n from ledger_entries where payment_id = $1", [
        (first as { value: { paymentId: string } }).value.paymentId,
      ]),
    );
    expect(entriesAfterSecond[0]!.n).toBe(entriesAfterFirst[0]!.n); // ledger intacto
  });

  it("refund PARCIAL de la allocation del comercio NO toca comisión ni delivery (#9)", async () => {
    const { orderId } = await newOrder();
    const intent = await createPaymentIntent(db, provider, { tenantId, orderId, idempotencyKey: "k3" });
    if (!intent.ok) return;
    const cap = await capturePayment(db, { tenantId, providerEventId: "evt-3", providerRef: intent.value.providerRef });
    if (!cap.ok) return;
    const paymentId = cap.value.paymentId;

    const [merchantAlloc] = await db.withTenant(tenantId, (tx) =>
      tx.query<{ id: string }>(
        "select id from payment_allocations where payment_id = $1 and target_type = 'merchant'",
        [paymentId],
      ),
    );

    const before = {
      merchant: await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId)),
      commission: await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission")),
      delivery: await db.withTenant(tenantId, (tx) => accountBalance(tx, "delivery")),
    };

    // Refund parcial de $7.900 (790.000 c) al comercio.
    const refund = await refundAllocation(db, {
      tenantId,
      paymentId,
      allocationId: merchantAlloc!.id,
      amountMinor: 790_000n,
      reason: "producto dañado",
    });
    expect(refund.ok).toBe(true);

    // El comercio baja exactamente el refund; comisión y delivery INTACTAS (delta 0).
    expect(before.merchant - (await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId)))).toBe(790_000n);
    expect(await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission"))).toBe(before.commission);
    expect(await db.withTenant(tenantId, (tx) => accountBalance(tx, "delivery"))).toBe(before.delivery);
    expect(await db.withTenant(tenantId, (tx) => ledgerIsBalanced(tx))).toBe(true);

    const view = await db.withTenant(tenantId, (tx) => getOrder(tx, orderId));
    expect(view?.status).toBe("partially_refunded");
  });

  it("no permite refundear más que lo disponible en la allocation", async () => {
    const { orderId } = await newOrder();
    const intent = await createPaymentIntent(db, provider, { tenantId, orderId, idempotencyKey: "k4" });
    if (!intent.ok) return;
    const cap = await capturePayment(db, { tenantId, providerEventId: "evt-4", providerRef: intent.value.providerRef });
    if (!cap.ok) return;
    const [commissionAlloc] = await db.withTenant(tenantId, (tx) =>
      tx.query<{ id: string }>(
        "select id from payment_allocations where payment_id = $1 and target_type = 'platform_commission'",
        [cap.value.paymentId],
      ),
    );
    const bad = await refundAllocation(db, {
      tenantId,
      paymentId: cap.value.paymentId,
      allocationId: commissionAlloc!.id,
      amountMinor: 999_999_999n,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/refund_exceeds_allocation/);
  });

  it("cobro al entregar: postea ledger balanceado, marca pagado y es idempotente (Eslabón 2)", async () => {
    const { orderId } = await newOrder(); // GMV 3.000.000
    // El pedido se aceptó (pago al recibir): pending_payment → confirmed, sin cobrar aún.
    await confirmOrder(db, tenantId, orderId);

    const before = {
      merchant: await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId)),
      commission: await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission")),
    };

    const paidBefore = await db.withTenant(tenantId, (tx) =>
      tx.query<{ payment_status: string }>("select payment_status from orders where id = $1", [orderId]),
    );
    expect(paidBefore[0]!.payment_status).toBe("pendiente");

    const settle = await settleCashOnDelivery(db, { tenantId, orderId, method: "efectivo" });
    expect(settle.ok).toBe(true);
    if (!settle.ok) return;
    expect(settle.value.alreadyPaid).toBe(false);

    // Impacta el ledger igual que un pago online: comisión 7% y payout al comercio.
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId))) - before.merchant).toBe(2_790_000n);
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "platform_commission"))) - before.commission).toBe(210_000n);
    expect(await db.withTenant(tenantId, (tx) => ledgerIsBalanced(tx))).toBe(true);

    const paidAfter = await db.withTenant(tenantId, (tx) =>
      tx.query<{ payment_status: string }>("select payment_status from orders where id = $1", [orderId]),
    );
    expect(paidAfter[0]!.payment_status).toBe("pagado");

    // Idempotente: cobrar de nuevo no duplica.
    const again = await settleCashOnDelivery(db, { tenantId, orderId, method: "efectivo" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.alreadyPaid).toBe(true);
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId))) - before.merchant).toBe(2_790_000n);
  });
});
