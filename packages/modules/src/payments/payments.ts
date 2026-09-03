import {
  type Db,
  type TenantAwareDb,
  resolveConfigValue,
  enqueueEvent,
} from "@commerce/platform";
import { type Result, ok, err, type CurrencyCode, type TenantContext } from "@commerce/contracts";
import { confirmReservation } from "../inventory/inventory.js";
import { computeAllocations, type Allocation } from "./allocations.js";
import { postLedger, type LedgerEntry } from "./ledger.js";
import type { PaymentProvider } from "./provider.js";

const CUSTOMER_ACCOUNT = "customer";

/** Cuenta del ledger para un tipo de allocation. */
function accountFor(a: Allocation): { account: string; accountRef?: string } {
  if (a.targetType === "merchant") return { account: "merchant", ...(a.targetRef ? { accountRef: a.targetRef } : {}) };
  return { account: a.targetType };
}

interface Quote {
  currency: CurrencyCode;
  gmv: bigint;
  deliveryChargeMinor: bigint;
  total: bigint;
  allocations: Allocation[];
}

/** Cotiza un pedido: comisión y delivery desde CONFIG (gratis sobre umbral) + allocations. */
async function quoteOrder(tx: Db, tenantId: string, orderId: string): Promise<Quote> {
  const [order] = await tx.query<{ currency: CurrencyCode; total_minor: string }>(
    `select currency, total_minor from orders where id = $1`,
    [orderId],
  );
  if (!order) throw new Error("order_not_found");
  const sellerOrders = await tx.query<{ id: string; merchant_id: string; subtotal_minor: string }>(
    `select id, merchant_id, subtotal_minor from seller_orders where order_id = $1`,
    [orderId],
  );

  const chain = { tenantId };
  const commissionBps = (await resolveConfigValue<number>(tx, "commission.rateBps", chain)).value;
  const freeOver = (await resolveConfigValue<number>(tx, "delivery.freeOverOrderTotalMinor", chain)).value;
  const baseCharge = (await resolveConfigValue<number>(tx, "delivery.customerChargeMinor", chain)).value;

  const gmv = BigInt(order.total_minor);
  const deliveryChargeMinor = gmv >= BigInt(freeOver) ? 0n : BigInt(baseCharge);

  const { total, allocations } = computeAllocations({
    currency: order.currency,
    commissionBps: BigInt(commissionBps),
    deliveryChargeMinor,
    sellerOrders: sellerOrders.map((s) => ({
      sellerOrderId: s.id,
      merchantId: s.merchant_id,
      subtotalMinor: BigInt(s.subtotal_minor),
    })),
  });

  return { currency: order.currency, gmv, deliveryChargeMinor, total, allocations };
}

function ctxOf(tenantId: string): TenantContext {
  return { tenantId, actor: { type: "system", id: "payments" } };
}

/** Crea el intent de pago (payment 'pending') vía el provider. Idempotente por key. */
export async function createPaymentIntent(
  db: TenantAwareDb,
  provider: PaymentProvider,
  input: { tenantId: string; orderId: string; idempotencyKey: string },
): Promise<Result<{ paymentId: string; providerRef: string }, string>> {
  try {
    return ok(
      await db.withTenant(input.tenantId, async (tx) => {
        const quote = await quoteOrder(tx, input.tenantId, input.orderId);
        const handle = await provider.createPayment(ctxOf(input.tenantId), {
          orderId: input.orderId,
          amount: { amountMinor: quote.total, currency: quote.currency },
          idempotencyKey: input.idempotencyKey,
        });
        const [p] = await tx.query<{ id: string }>(
          `insert into payments (tenant_id, order_id, provider, provider_ref, status, amount_minor, currency)
           values ($1,$2,$3,$4,'pending',$5,$6) returning id`,
          [input.tenantId, input.orderId, provider.name, handle.providerRef, quote.total.toString(), quote.currency],
        );
        return { paymentId: p!.id, providerRef: handle.providerRef };
      }),
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Captura el pago (típicamente desde el webhook 'payment.approved'). Idempotente por
 * `providerEventId` (dedup en processed_webhooks): un webhook repetido NO duplica pago ni
 * pedido (criterio de aceptación). Postea el ledger de doble partida (DEBE customer total,
 * HABER cada allocation), persiste las allocations, confirma las reservas y el pedido.
 */
export async function capturePayment(
  db: TenantAwareDb,
  input: { tenantId: string; providerEventId: string; providerRef: string },
): Promise<Result<{ paymentId: string; alreadyProcessed: boolean }, string>> {
  try {
    return ok(
      await db.withTenant(input.tenantId, async (tx) => {
        const [seen] = await tx.query<{ payment_id: string | null }>(
          `select payment_id from processed_webhooks where provider_event_id = $1`,
          [input.providerEventId],
        );
        if (seen) return { paymentId: seen.payment_id ?? "", alreadyProcessed: true };

        const [payment] = await tx.query<{ id: string; order_id: string; status: string }>(
          `select id, order_id, status from payments where provider_ref = $1`,
          [input.providerRef],
        );
        if (!payment) throw new Error("payment_not_found");
        if (payment.status !== "pending") throw new Error(`payment_not_pending:${payment.status}`);

        const quote = await quoteOrder(tx, input.tenantId, payment.order_id);

        // Persistir allocations.
        for (const a of quote.allocations) {
          await tx.query(
            `insert into payment_allocations (tenant_id, payment_id, seller_order_id, target_type, target_ref, amount_minor)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              input.tenantId,
              payment.id,
              a.sellerOrderId ?? null,
              a.targetType,
              a.targetRef ?? null,
              a.amountMinor.toString(),
            ],
          );
        }

        // Ledger de doble partida: DEBE customer total; HABER cada allocation.
        const entries: LedgerEntry[] = [
          { account: CUSTOMER_ACCOUNT, debitMinor: quote.total, memo: "pago cliente" },
          ...quote.allocations.map((a) => {
            const acc = accountFor(a);
            return { ...acc, creditMinor: a.amountMinor, memo: a.targetType };
          }),
        ];
        const posted = await postLedger(tx, input.tenantId, payment.id, entries);
        if (!posted.ok) throw new Error(posted.error);

        await tx.query(`update payments set status = 'captured', updated_at = now() where id = $1`, [payment.id]);

        // Confirmar reservas + pedido.
        const items = await tx.query<{ reservation_id: string | null }>(
          `select oi.reservation_id from order_items oi
             join seller_orders so on so.id = oi.seller_order_id
            where so.order_id = $1`,
          [payment.order_id],
        );
        for (const it of items) {
          if (it.reservation_id) {
            const c = await confirmReservation(tx, it.reservation_id);
            if (!c.ok) throw new Error(`reservation_confirm_failed:${it.reservation_id}`);
          }
        }
        await tx.query(`update orders set status = 'confirmed', payment_status = 'pagado', updated_at = now() where id = $1`, [payment.order_id]);

        await tx.query(
          `insert into processed_webhooks (provider_event_id, tenant_id, payment_id) values ($1,$2,$3)`,
          [input.providerEventId, input.tenantId, payment.id],
        );

        await enqueueEvent(tx, { tenantId: input.tenantId, type: "payment.captured", payload: { paymentId: payment.id, orderId: payment.order_id } });
        await enqueueEvent(tx, { tenantId: input.tenantId, type: "order.confirmed", payload: { orderId: payment.order_id } });

        return { paymentId: payment.id, alreadyProcessed: false };
      }),
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Refund PARCIAL sobre UNA allocation: postea el reverso (HABER customer, DEBE la cuenta
 * de esa allocation) y NO toca las demás partidas (criterio de aceptación #9). Actualiza
 * el estado del pago/pedido a partially_refunded o refunded según corresponda.
 */
export async function refundAllocation(
  db: TenantAwareDb,
  input: { tenantId: string; paymentId: string; allocationId: string; amountMinor: bigint; reason?: string },
): Promise<Result<true, string>> {
  try {
    await db.withTenant(input.tenantId, async (tx) => {
      const [alloc] = await tx.query<{
        target_type: string;
        target_ref: string | null;
        amount_minor: string;
        refunded_minor: string;
      }>(
        `select target_type, target_ref, amount_minor, refunded_minor
           from payment_allocations where id = $1 and payment_id = $2`,
        [input.allocationId, input.paymentId],
      );
      if (!alloc) throw new Error("allocation_not_found");

      const remaining = BigInt(alloc.amount_minor) - BigInt(alloc.refunded_minor);
      if (input.amountMinor <= 0n) throw new Error("invalid_amount");
      if (input.amountMinor > remaining) throw new Error(`refund_exceeds_allocation: ${input.amountMinor} > ${remaining}`);

      // Reverso balanceado: HABER customer, DEBE la cuenta de la allocation.
      const account = alloc.target_type === "merchant" ? "merchant" : alloc.target_type;
      const posted = await postLedger(tx, input.tenantId, input.paymentId, [
        { account: CUSTOMER_ACCOUNT, creditMinor: input.amountMinor, memo: "refund" },
        {
          account,
          ...(alloc.target_ref ? { accountRef: alloc.target_ref } : {}),
          debitMinor: input.amountMinor,
          memo: "refund",
        },
      ]);
      if (!posted.ok) throw new Error(posted.error);

      await tx.query(`update payment_allocations set refunded_minor = refunded_minor + $2 where id = $1`, [
        input.allocationId,
        input.amountMinor.toString(),
      ]);
      await tx.query(
        `insert into refunds (tenant_id, payment_id, allocation_id, amount_minor, reason) values ($1,$2,$3,$4,$5)`,
        [input.tenantId, input.paymentId, input.allocationId, input.amountMinor.toString(), input.reason ?? null],
      );

      // ¿Refund total del pago? (todas las allocations completamente devueltas)
      const [agg] = await tx.query<{ amt: string; ref: string }>(
        `select coalesce(sum(amount_minor),0)::text amt, coalesce(sum(refunded_minor),0)::text ref
           from payment_allocations where payment_id = $1`,
        [input.paymentId],
      );
      const fully = BigInt(agg!.amt) === BigInt(agg!.ref);
      const [pay] = await tx.query<{ order_id: string }>(`select order_id from payments where id = $1`, [input.paymentId]);
      await tx.query(`update payments set status = $2, updated_at = now() where id = $1`, [
        input.paymentId,
        fully ? "refunded" : "partially_refunded",
      ]);
      if (pay) {
        await tx.query(`update orders set status = $2, updated_at = now() where id = $1`, [
          pay.order_id,
          fully ? "refunded" : "partially_refunded",
        ]);
      }

      await enqueueEvent(tx, { tenantId: input.tenantId, type: "payment.refunded", payload: { paymentId: input.paymentId, amountMinor: input.amountMinor.toString() } });
    });
    return ok(true);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
