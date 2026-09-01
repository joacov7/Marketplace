import type { Db } from "@commerce/platform";

/**
 * Módulo Reportes (solo LECTURA). No tiene tablas propias: proyecta métricas sobre el
 * ledger (fuente de verdad del dinero — [D7]) y sobre orders/order_items/inventory. Todas
 * las funciones corren DENTRO de un contexto de tenant (withTenant → RLS), así que nunca
 * ven datos de otro tenant, y no reciben `tenantId`: lo impone la policy.
 *
 * Convención de saldo del ledger: balance = Σcréditos − Σdébitos. Un refund debita la
 * cuenta original, por eso todas las cuentas de ingreso se leen NETAS de devoluciones.
 */

/** Estados de pedido que representan una venta cobrada (excluye pending_payment/cancelled). */
const PAID_STATUSES = "('confirmed','completed','partially_refunded','refunded')";

export interface SalesSummary {
  /** Pedidos cobrados en la ventana. */
  paidOrders: number;
  /** GMV = valor de mercadería vendida (Σ subtotales de seller_orders), en centavos. */
  gmvMinor: bigint;
  /** Ingreso por envío cobrado al cliente (neto de refunds), en centavos. */
  deliveryRevenueMinor: bigint;
  /** Contribución de la plataforma = comisión neta de refunds, en centavos. */
  commissionMinor: bigint;
  /** A pagar a comercios (payout) = crédito neto de las cuentas merchant, en centavos. */
  merchantPayoutMinor: bigint;
  /** Total devuelto a clientes (refunds), en centavos. */
  refundsMinor: bigint;
  /** Ticket promedio = total cobrado / pedidos cobrados, en centavos (0 si no hay). */
  avgTicketMinor: bigint;
}

export interface ReportWindow {
  /** ISO date/datetime inclusive. Si se omite, sin límite inferior. */
  from?: string;
  /** ISO date/datetime exclusivo. Si se omite, sin límite superior. */
  to?: string;
}

function windowClause(w: ReportWindow, col: string, params: unknown[]): string {
  let sql = "";
  if (w.from) {
    params.push(w.from);
    sql += ` and ${col} >= $${params.length}`;
  }
  if (w.to) {
    params.push(w.to);
    sql += ` and ${col} < $${params.length}`;
  }
  return sql;
}

/** Resumen de ventas de la ventana: GMV, envío, comisión (contribución), payout, refunds. */
export async function salesSummary(db: Db, window: ReportWindow = {}): Promise<SalesSummary> {
  // Pedidos + GMV desde orders/seller_orders (mercadería). El GMV es la base de la
  // comisión, NO ingreso de plataforma (corrección de Fase 0).
  const orderParams: unknown[] = [];
  const [orders] = await db.query<{ paid_orders: string; gmv: string }>(
    `select count(distinct o.id)::text as paid_orders,
            coalesce(sum(so.subtotal_minor),0)::text as gmv
       from orders o
       join seller_orders so on so.order_id = o.id
      where o.status in ${PAID_STATUSES}${windowClause(window, "o.created_at", orderParams)}`,
    orderParams,
  );

  // Dinero real desde el ledger (neto de refunds). Un solo barrido por cuenta.
  const ledgerParams: unknown[] = [];
  const rows = await db.query<{ account: string; net: string }>(
    `select account, coalesce(sum(credit_minor) - sum(debit_minor),0)::text as net
       from ledger_entries
      where 1=1${windowClause(window, "created_at", ledgerParams)}
      group by account`,
    ledgerParams,
  );
  const byAccount = new Map(rows.map((r) => [r.account, BigInt(r.net)]));

  const paidOrders = Number(orders?.paid_orders ?? "0");
  const gmvMinor = BigInt(orders?.gmv ?? "0");
  const deliveryRevenueMinor = byAccount.get("delivery") ?? 0n;
  const commissionMinor = byAccount.get("platform_commission") ?? 0n;
  const merchantPayoutMinor = byAccount.get("merchant") ?? 0n;
  // customer: DEBE al pagar, HABER al refund → neto negativo = plata cobrada; refunds = crédito.
  const refundsMinor = await refundsTotal(db, window);
  const collectedMinor = merchantPayoutMinor + commissionMinor + deliveryRevenueMinor;
  const avgTicketMinor = paidOrders > 0 ? collectedMinor / BigInt(paidOrders) : 0n;

  return {
    paidOrders,
    gmvMinor,
    deliveryRevenueMinor,
    commissionMinor,
    merchantPayoutMinor,
    refundsMinor,
    avgTicketMinor,
  };
}

async function refundsTotal(db: Db, window: ReportWindow): Promise<bigint> {
  const params: unknown[] = [];
  const [row] = await db.query<{ r: string }>(
    `select coalesce(sum(credit_minor),0)::text as r
       from ledger_entries
      where account = 'customer'${windowClause(window, "created_at", params)}`,
    params,
  );
  return BigInt(row?.r ?? "0");
}

export interface TopProductRow {
  productId: string;
  productName: string;
  unitsSold: number;
  revenueMinor: bigint;
}

/** Top de productos por unidades vendidas (pedidos cobrados). Agrupa variantes por producto. */
export async function topProducts(db: Db, opts: { limit?: number } & ReportWindow = {}): Promise<TopProductRow[]> {
  const params: unknown[] = [];
  const win = windowClause(opts, "o.created_at", params);
  params.push(opts.limit ?? 10);
  const rows = await db.query<{ product_id: string; product_name: string; units: string; revenue: string }>(
    `select p.id as product_id, p.name as product_name,
            coalesce(sum(oi.qty),0)::text as units,
            coalesce(sum(oi.qty * oi.unit_price_minor),0)::text as revenue
       from order_items oi
       join seller_orders so on so.id = oi.seller_order_id
       join orders o on o.id = so.order_id
       join variants v on v.id = oi.variant_id
       join products p on p.id = v.product_id
      where o.status in ${PAID_STATUSES}${win}
      group by p.id, p.name
      order by units desc
      limit $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    unitsSold: Number(r.units),
    revenueMinor: BigInt(r.revenue),
  }));
}

export interface StockAlertRow {
  variantId: string;
  productName: string;
  variantName: string;
  available: number;
  reserved: number;
}

/** Variantes con stock disponible en o por debajo del umbral (default 5). Para reposición. */
export async function stockAlerts(db: Db, opts: { threshold?: number; limit?: number } = {}): Promise<StockAlertRow[]> {
  const threshold = opts.threshold ?? 5;
  const rows = await db.query<{
    variant_id: string;
    product_name: string;
    variant_name: string;
    available: number;
    reserved: number;
  }>(
    `select i.variant_id, p.name as product_name, v.name as variant_name, i.available, i.reserved
       from inventory i
       join variants v on v.id = i.variant_id
       join products p on p.id = v.product_id
      where i.available <= $1
      order by i.available asc
      limit $2`,
    [threshold, opts.limit ?? 50],
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    productName: r.product_name,
    variantName: r.variant_name,
    available: r.available,
    reserved: r.reserved,
  }));
}

export interface SalesByDayRow {
  day: string; // YYYY-MM-DD
  orders: number;
  gmvMinor: bigint;
}

/** Serie diaria de los últimos `days` días (default 14): pedidos cobrados y GMV por día. */
export async function salesByDay(db: Db, opts: { days?: number } = {}): Promise<SalesByDayRow[]> {
  const days = opts.days ?? 14;
  const rows = await db.query<{ day: string; orders: string; gmv: string }>(
    `select to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') as day,
            count(distinct o.id)::text as orders,
            coalesce(sum(so.subtotal_minor),0)::text as gmv
       from orders o
       join seller_orders so on so.order_id = o.id
      where o.status in ${PAID_STATUSES}
        and o.created_at >= (now() - ($1 || ' days')::interval)
      group by 1
      order by 1 asc`,
    [String(days)],
  );
  return rows.map((r) => ({ day: r.day, orders: Number(r.orders), gmvMinor: BigInt(r.gmv) }));
}
