import {
  type Db,
  type TenantAwareDb,
  resolveConfigValue,
  enqueueEvent,
} from "@commerce/platform";
import { type Result, ok, err, type CurrencyCode } from "@commerce/contracts";
import { reserveStock, confirmReservation, releaseReservation } from "../inventory/inventory.js";
import { canTransitionOrder, canTransitionSellerOrder, type SellerOrderStatus } from "./state.js";

export interface CreateOrderInput {
  tenantId: string;
  customerId?: string;
  currency?: CurrencyCode;
  /** Datos de entrega capturados en el checkout (opcionales). */
  shippingAddress?: Record<string, unknown>;
  deliveryWindow?: string;
  deliveryChargeMinor?: bigint;
  sellers: ReadonlyArray<{
    merchantId: string;
    items: ReadonlyArray<{ variantId: string; qty: number; unitPriceMinor: bigint }>;
  }>;
}

export interface CreatedOrder {
  orderId: string;
  sellerOrderIds: string[];
  totalMinor: bigint;
}

/**
 * Crea un pedido reservando stock atómicamente. Reglas clave:
 *  - `orders.maxSellersPerOrder` (CONFIG, no código): V1 = 1 comercio por pedido; subir
 *    el flag habilita multi-seller SIN tocar el esquema ([E1]).
 *  - Items cuelgan de seller_order (multi-seller = N seller_orders).
 *  - Atómico: si una reserva falla, rollback total (no queda pedido ni reservas colgadas).
 *  - Emite `order.created` por el outbox en la misma tx.
 */
export async function createOrder(
  db: TenantAwareDb,
  input: CreateOrderInput,
): Promise<Result<CreatedOrder, string>> {
  const currency: CurrencyCode = input.currency ?? "ARS";
  try {
    const result = await db.withTenant(input.tenantId, async (tx) => {
      const maxSellers = await resolveConfigValue<number>(tx, "orders.maxSellersPerOrder", {
        tenantId: input.tenantId,
      });
      if (input.sellers.length > maxSellers.value) {
        throw new Error(`too_many_sellers: ${input.sellers.length} > ${maxSellers.value}`);
      }
      if (input.sellers.length === 0) throw new Error("empty_order");

      const [order] = await tx.query<{ id: string }>(
        `insert into orders (tenant_id, customer_id, status, currency, total_minor, shipping_address, delivery_window, delivery_charge_minor)
         values ($1,$2,'pending_payment',$3,0,$4,$5,$6) returning id`,
        [
          input.tenantId,
          input.customerId ?? null,
          currency,
          input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
          input.deliveryWindow ?? null,
          (input.deliveryChargeMinor ?? 0n).toString(),
        ],
      );
      const orderId = order!.id;

      const sellerOrderIds: string[] = [];
      let orderTotal = 0n;

      for (const seller of input.sellers) {
        const [so] = await tx.query<{ id: string }>(
          `insert into seller_orders (tenant_id, order_id, merchant_id) values ($1,$2,$3) returning id`,
          [input.tenantId, orderId, seller.merchantId],
        );
        const sellerOrderId = so!.id;
        sellerOrderIds.push(sellerOrderId);

        let subtotal = 0n;
        for (const item of seller.items) {
          const reserved = await reserveStock(tx, {
            tenantId: input.tenantId,
            variantId: item.variantId,
            qty: item.qty,
            orderId,
          });
          if (!reserved.ok) throw new Error(`${reserved.error}:${item.variantId}`);

          await tx.query(
            `insert into order_items (tenant_id, seller_order_id, variant_id, qty, unit_price_minor, reservation_id)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              input.tenantId,
              sellerOrderId,
              item.variantId,
              item.qty,
              item.unitPriceMinor.toString(),
              reserved.value.reservationId,
            ],
          );
          subtotal += item.unitPriceMinor * BigInt(item.qty);
        }

        await tx.query(`update seller_orders set subtotal_minor = $2 where id = $1`, [
          sellerOrderId,
          subtotal.toString(),
        ]);
        orderTotal += subtotal;
      }

      await tx.query(`update orders set total_minor = $2, updated_at = now() where id = $1`, [
        orderId,
        orderTotal.toString(),
      ]);

      await enqueueEvent(tx, {
        tenantId: input.tenantId,
        type: "order.created",
        payload: { orderId, totalMinor: orderTotal.toString(), sellers: input.sellers.length },
      });

      return { orderId, sellerOrderIds, totalMinor: orderTotal };
    });
    return ok(result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

async function loadOrderStatus(tx: Db, orderId: string): Promise<string | null> {
  const [row] = await tx.query<{ status: string }>(`select status from orders where id = $1`, [orderId]);
  return row?.status ?? null;
}

/**
 * Confirma el pedido tras el pago: consume las reservas (venta), pasa a 'confirmed' y
 * emite `order.confirmed`. (El pago real y el ledger llegan en el módulo Payments.)
 */
export async function confirmOrder(db: TenantAwareDb, tenantId: string, orderId: string): Promise<Result<true, string>> {
  try {
    await db.withTenant(tenantId, async (tx) => {
      const status = await loadOrderStatus(tx, orderId);
      if (status === null) throw new Error("order_not_found");
      if (!canTransitionOrder(status as never, "confirmed")) throw new Error(`invalid_transition:${status}->confirmed`);

      const items = await tx.query<{ reservation_id: string | null }>(
        `select oi.reservation_id from order_items oi
           join seller_orders so on so.id = oi.seller_order_id
          where so.order_id = $1`,
        [orderId],
      );
      for (const it of items) {
        if (it.reservation_id) {
          const c = await confirmReservation(tx, it.reservation_id);
          if (!c.ok) throw new Error(`reservation_confirm_failed:${it.reservation_id}`);
        }
      }
      await tx.query(`update orders set status = 'confirmed', updated_at = now() where id = $1`, [orderId]);
      await enqueueEvent(tx, { tenantId, type: "order.confirmed", payload: { orderId } });
    });
    return ok(true);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Cancela el pedido: libera las reservas 'held' (compensación) y pasa a 'cancelled'.
 * Emite `order.cancelled`.
 */
export async function cancelOrder(db: TenantAwareDb, tenantId: string, orderId: string): Promise<Result<true, string>> {
  try {
    await db.withTenant(tenantId, async (tx) => {
      const status = await loadOrderStatus(tx, orderId);
      if (status === null) throw new Error("order_not_found");
      if (!canTransitionOrder(status as never, "cancelled")) throw new Error(`invalid_transition:${status}->cancelled`);

      const items = await tx.query<{ reservation_id: string | null }>(
        `select oi.reservation_id from order_items oi
           join seller_orders so on so.id = oi.seller_order_id
          where so.order_id = $1`,
        [orderId],
      );
      for (const it of items) {
        if (it.reservation_id) await releaseReservation(tx, it.reservation_id); // no-op si ya no está 'held'
      }
      await tx.query(`update orders set status = 'cancelled', updated_at = now() where id = $1`, [orderId]);
      await tx.query(`update seller_orders set status = 'cancelled' where order_id = $1`, [orderId]);
      await enqueueEvent(tx, { tenantId, type: "order.cancelled", payload: { orderId } });
    });
    return ok(true);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export interface OrderView {
  id: string;
  status: string;
  currency: CurrencyCode;
  totalMinor: bigint;
  sellerOrders: Array<{ id: string; merchantId: string; status: string; subtotalMinor: bigint }>;
}

export interface SellerOrderRow {
  sellerOrderId: string;
  orderId: string;
  merchantId: string;
  customerId: string | null;
  status: SellerOrderStatus;
  subtotalMinor: bigint;
  currency: string;
  itemCount: number;
  createdAt: string;
}

/**
 * Lista los seller_orders PAGADOS (la cola de preparación del comercio). Solo pedidos ya
 * confirmados; los `pending_payment` no se muestran. Corre con contexto de tenant (RLS).
 */
export async function listSellerOrders(db: Db, opts: { limit?: number } = {}): Promise<SellerOrderRow[]> {
  const rows = await db.query<{
    seller_order_id: string;
    order_id: string;
    merchant_id: string;
    customer_id: string | null;
    status: SellerOrderStatus;
    subtotal_minor: string;
    currency: string;
    item_count: string;
    created_at: string;
  }>(
    `select so.id as seller_order_id, so.order_id, so.merchant_id, o.customer_id, so.status,
            so.subtotal_minor, o.currency, o.created_at,
            (select count(*) from order_items oi where oi.seller_order_id = so.id) as item_count
       from seller_orders so
       join orders o on o.id = so.order_id
      where o.status in ('confirmed','completed','partially_refunded')
      order by o.created_at desc
      limit $1`,
    [opts.limit ?? 100],
  );
  return rows.map((r) => ({
    sellerOrderId: r.seller_order_id,
    orderId: r.order_id,
    merchantId: r.merchant_id,
    customerId: r.customer_id,
    status: r.status,
    subtotalMinor: BigInt(r.subtotal_minor),
    currency: r.currency,
    itemCount: Number(r.item_count),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Transiciona el estado de CUMPLIMIENTO de un seller_order (pending→preparing→ready→
 * in_transit→delivered, o rejected/failed) validando la máquina de estados. Emite evento.
 */
export async function transitionSellerOrder(
  db: TenantAwareDb,
  tenantId: string,
  sellerOrderId: string,
  to: SellerOrderStatus,
): Promise<Result<true, string>> {
  try {
    await db.withTenant(tenantId, async (tx) => {
      const [row] = await tx.query<{ status: SellerOrderStatus }>(
        `select status from seller_orders where id = $1`,
        [sellerOrderId],
      );
      if (!row) throw new Error("seller_order_not_found");
      if (!canTransitionSellerOrder(row.status, to)) throw new Error(`invalid_transition:${row.status}->${to}`);
      await tx.query(`update seller_orders set status = $2 where id = $1`, [sellerOrderId, to]);
      await enqueueEvent(tx, { tenantId, type: `seller_order.${to}`, payload: { sellerOrderId } });
    });
    return ok(true);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function getOrder(db: Db, orderId: string): Promise<OrderView | null> {
  const [o] = await db.query<{ id: string; status: string; currency: CurrencyCode; total_minor: string }>(
    `select id, status, currency, total_minor from orders where id = $1`,
    [orderId],
  );
  if (!o) return null;
  const sos = await db.query<{ id: string; merchant_id: string; status: string; subtotal_minor: string }>(
    `select id, merchant_id, status, subtotal_minor from seller_orders where order_id = $1`,
    [orderId],
  );
  return {
    id: o.id,
    status: o.status,
    currency: o.currency,
    totalMinor: BigInt(o.total_minor),
    sellerOrders: sos.map((s) => ({
      id: s.id,
      merchantId: s.merchant_id,
      status: s.status,
      subtotalMinor: BigInt(s.subtotal_minor),
    })),
  };
}
