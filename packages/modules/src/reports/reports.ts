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

export interface WeekdaySalesRow {
  /** Día ISO: 1 = lunes … 7 = domingo. */
  dow: number;
  orders: number;
  units: number;
  gmvMinor: bigint;
  /** Producto más vendido de ese día (por unidades). null si no hubo ventas. */
  topProduct: string | null;
  topUnits: number;
}

/**
 * Ventas por DÍA DE LA SEMANA (para anticipar stock: qué días concentran demanda y qué se
 * vende más cada día). Une los pedidos cobrados con sus items; el "top" de cada día sale por
 * unidades. Filas ralas (solo días con ventas): el panel completa lunes→domingo.
 */
export async function salesByWeekday(db: Db, window: ReportWindow = {}): Promise<WeekdaySalesRow[]> {
  const aParams: unknown[] = [];
  const aWin = windowClause(window, "o.created_at", aParams);
  const agg = await db.query<{ dow: number; orders: string; units: string; gmv: string }>(
    `select extract(isodow from o.created_at)::int as dow,
            count(distinct o.id)::text as orders,
            coalesce(sum(oi.qty),0)::text as units,
            coalesce(sum(oi.qty * oi.unit_price_minor),0)::text as gmv
       from orders o
       join seller_orders so on so.order_id = o.id
       join order_items oi on oi.seller_order_id = so.id
      where o.status in ${PAID_STATUSES}${aWin}
      group by 1`,
    aParams,
  );
  const tParams: unknown[] = [];
  const tWin = windowClause(window, "o.created_at", tParams);
  const tops = await db.query<{ dow: number; product_name: string; units: string }>(
    `select dow, product_name, units from (
       select extract(isodow from o.created_at)::int as dow, p.name as product_name,
              sum(oi.qty) as units,
              row_number() over (partition by extract(isodow from o.created_at)::int order by sum(oi.qty) desc, p.name) as rn
         from order_items oi
         join seller_orders so on so.id = oi.seller_order_id
         join orders o on o.id = so.order_id
         join variants v on v.id = oi.variant_id
         join products p on p.id = v.product_id
        where o.status in ${PAID_STATUSES}${tWin}
        group by 1, p.name
     ) t where rn = 1`,
    tParams,
  );
  const topByDow = new Map(tops.map((t) => [Number(t.dow), { name: t.product_name, units: Number(t.units) }]));
  return agg.map((r) => {
    const top = topByDow.get(Number(r.dow));
    return {
      dow: Number(r.dow),
      orders: Number(r.orders),
      units: Number(r.units),
      gmvMinor: BigInt(r.gmv),
      topProduct: top?.name ?? null,
      topUnits: top?.units ?? 0,
    };
  });
}

export interface SlotSalesRow {
  /** Etiqueta del turno elegido en el pedido (delivery_window). */
  slot: string;
  orders: number;
  units: number;
  gmvMinor: bigint;
}

/**
 * Ventas por TURNO de entrega (delivery_window del pedido), ordenadas por unidades. Muestra en
 * qué franja se concentra la demanda para planificar reparto y stock. Sin turno → "(sin turno)".
 */
export async function salesBySlot(db: Db, window: ReportWindow = {}): Promise<SlotSalesRow[]> {
  const params: unknown[] = [];
  const win = windowClause(window, "o.created_at", params);
  const rows = await db.query<{ slot: string; orders: string; units: string; gmv: string }>(
    `select coalesce(nullif(trim(o.delivery_window), ''), '(sin turno)') as slot,
            count(distinct o.id)::text as orders,
            coalesce(sum(oi.qty),0)::text as units,
            coalesce(sum(oi.qty * oi.unit_price_minor),0)::text as gmv
       from orders o
       join seller_orders so on so.order_id = o.id
       join order_items oi on oi.seller_order_id = so.id
      where o.status in ${PAID_STATUSES}${win}
      group by 1
      order by sum(oi.qty) desc`,
    params,
  );
  return rows.map((r) => ({ slot: r.slot, orders: Number(r.orders), units: Number(r.units), gmvMinor: BigInt(r.gmv) }));
}

export interface SubscriptionMetrics {
  /** Suscripciones vigentes (motor de recompra). */
  activeSubs: number;
  pausedSubs: number;
  cancelledSubs: number;
  /** Pedidos de auto-envío generados por suscripción en la ventana. */
  generatedOrders: number;
  /** De esos, los que se volvieron venta (confirmado/completado). */
  confirmedOrders: number;
  /** Los cancelados/rechazados (el cliente no confirmó). */
  rejectedOrders: number;
  /** Los que todavía están a aceptar/en curso (aún sin decidir). */
  pendingOrders: number;
  /** confirmados / (confirmados + rechazados). 0..1; 0 si nada se decidió aún. */
  confirmationRate: number;
}

/**
 * Métrica de salud de la suscripción: cuántos envíos automáticos se generan y qué porcentaje
 * el cliente CONFIRMA (se vuelve venta) vs. no confirma (cancela/rechaza). Es el número que dice
 * si el auto-envío realmente retiene. Los pedidos de suscripción se identifican por
 * `orders.channel = 'suscripcion'`; el estado del pedido define confirmado/rechazado/pendiente.
 */
export async function subscriptionMetrics(db: Db, window: ReportWindow = {}): Promise<SubscriptionMetrics> {
  const orderParams: unknown[] = [];
  const win = windowClause(window, "created_at", orderParams);
  const [o] = await db.query<{ generated: string; confirmed: string; rejected: string; pending: string }>(
    `select
       count(*) filter (where channel = 'suscripcion')::text                                as generated,
       count(*) filter (where channel = 'suscripcion' and status in ${PAID_STATUSES})::text as confirmed,
       count(*) filter (where channel = 'suscripcion' and status = 'cancelled')::text       as rejected,
       count(*) filter (where channel = 'suscripcion' and status = 'pending_payment')::text as pending
     from orders where 1=1${win}`,
    orderParams,
  );
  const [s] = await db.query<{ active: string; paused: string; cancelled: string }>(
    `select
       count(*) filter (where status = 'active')::text    as active,
       count(*) filter (where status = 'paused')::text    as paused,
       count(*) filter (where status = 'cancelled')::text as cancelled
     from subscriptions`,
  );
  const confirmed = Number(o?.confirmed ?? 0);
  const rejected = Number(o?.rejected ?? 0);
  const decided = confirmed + rejected;
  return {
    activeSubs: Number(s?.active ?? 0),
    pausedSubs: Number(s?.paused ?? 0),
    cancelledSubs: Number(s?.cancelled ?? 0),
    generatedOrders: Number(o?.generated ?? 0),
    confirmedOrders: confirmed,
    rejectedOrders: rejected,
    pendingOrders: Number(o?.pending ?? 0),
    confirmationRate: decided > 0 ? confirmed / decided : 0,
  };
}
