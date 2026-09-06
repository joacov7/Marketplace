import { type Db, type TenantAwareDb } from "@commerce/platform";
import { type Result, ok, err, type CurrencyCode } from "@commerce/contracts";
import { createOrder, type PaymentMethod } from "../orders/orders.js";

/**
 * Suscripción de auto-envío (flywheel: retención). El cliente se suscribe a su alimento y
 * cada `intervalDays` días se genera un pedido SOLO, con canal 'suscripcion', cobrado al
 * recibir (pago pendiente) — no requiere Mercado Pago. La mascota es el centro (pet snapshot).
 *
 * PROPOSE-safe: la generación reusa `createOrder` (reserva stock atómica) y deja el pedido en
 * la cola "por aceptar" del comercio; nadie cobra hasta la entrega.
 */

export type SubscriptionStatus = "active" | "paused" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  qty: number;
  intervalDays: number;
  nextRunAt: string;
  petName: string | null;
  variantName: string;
  productName: string;
}

export interface SubscriptionAdminRow extends Subscription {
  paymentMethod: string;
  discountPercent: number;
  customerName: string | null;
  customerPhone: string | null;
  lastRunAt: string | null;
  lastOrderId: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface CreateSubscriptionInput {
  tenantId: string;
  merchantId: string;
  variantId: string;
  qty: number;
  intervalDays: number;
  customerId?: string;
  paymentMethod?: PaymentMethod;
  discountPercent?: number;
  petId?: string;
  petName?: string;
  ship?: { street?: string; zone?: string; phone?: string; notes?: string; lat?: number; lng?: number };
}

/** Crea una suscripción. El primer envío automático se agenda para dentro de `intervalDays`. */
export async function createSubscription(
  db: TenantAwareDb,
  input: CreateSubscriptionInput,
): Promise<Result<{ id: string; nextRunAt: string }, string>> {
  if (input.qty <= 0) return err("qty_invalida");
  if (input.intervalDays < 1 || input.intervalDays > 365) return err("intervalo_invalido");
  const discount = Math.max(0, Math.min(90, Math.round(input.discountPercent ?? 0)));

  try {
    const row = await db.withTenant(input.tenantId, async (tx) => {
      const [r] = await tx.query<{ id: string; next_run_at: string }>(
        `insert into subscriptions
           (tenant_id, customer_id, merchant_id, variant_id, qty, interval_days, next_run_at,
            payment_method, discount_percent, pet_id, pet_name,
            ship_street, ship_zone, ship_phone, ship_notes, ship_lat, ship_lng)
         values ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $6),
                 $7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         returning id, next_run_at`,
        [
          input.tenantId,
          input.customerId ?? null,
          input.merchantId,
          input.variantId,
          input.qty,
          input.intervalDays,
          input.paymentMethod ?? "efectivo",
          discount,
          input.petId ?? null,
          input.petName ?? null,
          input.ship?.street ?? null,
          input.ship?.zone ?? null,
          input.ship?.phone ?? null,
          input.ship?.notes ?? null,
          input.ship?.lat ?? null,
          input.ship?.lng ?? null,
        ],
      );
      return r!;
    });
    return ok({ id: row.id, nextRunAt: row.next_run_at });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** Suscripciones de un cliente (para "Mis suscripciones"). No incluye canceladas. */
export async function listCustomerSubscriptions(db: Db, customerId: string): Promise<Subscription[]> {
  const rows = await db.query<{
    id: string; status: SubscriptionStatus; qty: number; interval_days: number;
    next_run_at: string; pet_name: string | null; variant_name: string; product_name: string;
  }>(
    `select s.id, s.status, s.qty, s.interval_days, s.next_run_at, s.pet_name,
            v.name as variant_name, pr.name as product_name
       from subscriptions s
       join variants v on v.id = s.variant_id
       join products pr on pr.id = v.product_id
      where s.customer_id = $1 and s.status <> 'cancelled'
      order by s.next_run_at`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.id, status: r.status, qty: r.qty, intervalDays: r.interval_days,
    nextRunAt: r.next_run_at, petName: r.pet_name, variantName: r.variant_name, productName: r.product_name,
  }));
}

/** Todas las suscripciones del comercio (vista admin). */
export async function listSubscriptionsAdmin(db: Db): Promise<SubscriptionAdminRow[]> {
  const rows = await db.query<{
    id: string; status: SubscriptionStatus; qty: number; interval_days: number; next_run_at: string;
    pet_name: string | null; variant_name: string; product_name: string;
    payment_method: string; discount_percent: number; customer_name: string | null; customer_phone: string | null;
    last_run_at: string | null; last_order_id: string | null; last_error: string | null; created_at: string;
  }>(
    `select s.id, s.status, s.qty, s.interval_days, s.next_run_at, s.pet_name,
            v.name as variant_name, pr.name as product_name,
            s.payment_method, s.discount_percent, c.name as customer_name, c.phone as customer_phone,
            s.last_run_at, s.last_order_id, s.last_error, s.created_at
       from subscriptions s
       join variants v on v.id = s.variant_id
       join products pr on pr.id = v.product_id
       left join customers c on c.id = s.customer_id
      order by (s.status = 'active') desc, s.next_run_at`,
  );
  return rows.map((r) => ({
    id: r.id, status: r.status, qty: r.qty, intervalDays: r.interval_days, nextRunAt: r.next_run_at,
    petName: r.pet_name, variantName: r.variant_name, productName: r.product_name,
    paymentMethod: r.payment_method, discountPercent: r.discount_percent,
    customerName: r.customer_name, customerPhone: r.customer_phone,
    lastRunAt: r.last_run_at, lastOrderId: r.last_order_id, lastError: r.last_error, createdAt: r.created_at,
  }));
}

/** Pausa / reanuda / cancela / ajusta una suscripción. Devuelve true si existía. */
export async function updateSubscription(
  db: Db,
  id: string,
  patch: { status?: SubscriptionStatus; intervalDays?: number; qty?: number },
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.status) { sets.push(`status = $${i++}`); vals.push(patch.status); }
  if (patch.intervalDays !== undefined) {
    if (patch.intervalDays < 1 || patch.intervalDays > 365) throw new Error("intervalo_invalido");
    sets.push(`interval_days = $${i++}`); vals.push(patch.intervalDays);
  }
  if (patch.qty !== undefined) {
    if (patch.qty <= 0) throw new Error("qty_invalida");
    sets.push(`qty = $${i++}`); vals.push(patch.qty);
  }
  if (sets.length === 0) return true;
  sets.push("updated_at = now()");
  const rows = await db.query<{ id: string }>(
    `update subscriptions set ${sets.join(", ")} where id = $${i} returning id`,
    [...vals, id],
  );
  return rows.length > 0;
}

interface DueSubscription {
  id: string;
  customerId: string | null;
  merchantId: string;
  variantId: string;
  qty: number;
  paymentMethod: string;
  discountPercent: number;
  petId: string | null;
  petName: string | null;
  shipStreet: string | null;
  shipZone: string | null;
  shipPhone: string | null;
  shipNotes: string | null;
  shipLat: number | null;
  shipLng: number | null;
  priceMinor: bigint | null;
  currency: CurrencyCode | null;
  available: number;
}

/** Suscripciones activas cuyo próximo envío ya venció (para el cron). Con precio y stock actuales. */
export async function listDueSubscriptions(db: Db): Promise<DueSubscription[]> {
  const rows = await db.query<{
    id: string; customer_id: string | null; merchant_id: string; variant_id: string; qty: number;
    payment_method: string; discount_percent: number; pet_id: string | null; pet_name: string | null;
    ship_street: string | null; ship_zone: string | null; ship_phone: string | null; ship_notes: string | null;
    ship_lat: number | null; ship_lng: number | null;
    price_minor: string | null; currency: CurrencyCode | null; available: number;
  }>(
    `select s.id, s.customer_id, s.merchant_id, s.variant_id, s.qty, s.payment_method, s.discount_percent,
            s.pet_id, s.pet_name, s.ship_street, s.ship_zone, s.ship_phone, s.ship_notes, s.ship_lat, s.ship_lng,
            p.amount_minor as price_minor, p.currency, coalesce(inv.available, 0) as available
       from subscriptions s
       left join lateral (
         select amount_minor, currency from prices
          where variant_id = s.variant_id and effective_from <= now()
          order by effective_from desc limit 1
       ) p on true
       left join inventory inv on inv.variant_id = s.variant_id
      where s.status = 'active' and s.next_run_at <= now()
      order by s.next_run_at`,
  );
  return rows.map((r) => ({
    id: r.id, customerId: r.customer_id, merchantId: r.merchant_id, variantId: r.variant_id, qty: r.qty,
    paymentMethod: r.payment_method, discountPercent: r.discount_percent, petId: r.pet_id, petName: r.pet_name,
    shipStreet: r.ship_street, shipZone: r.ship_zone, shipPhone: r.ship_phone, shipNotes: r.ship_notes,
    shipLat: r.ship_lat, shipLng: r.ship_lng,
    priceMinor: r.price_minor !== null ? BigInt(r.price_minor) : null, currency: r.currency, available: r.available,
  }));
}

/** Avanza el próximo envío un intervalo y registra el resultado del ciclo. */
async function advanceSubscription(db: Db, id: string, result: { orderId?: string; error?: string }): Promise<void> {
  await db.query(
    `update subscriptions
        set next_run_at = case when next_run_at + make_interval(days => interval_days) > now()
                               then next_run_at + make_interval(days => interval_days)
                               else now() + make_interval(days => interval_days) end,
            last_run_at = now(),
            last_order_id = $2,
            last_error = $3,
            updated_at = now()
      where id = $1`,
    [id, result.orderId ?? null, result.error ?? null],
  );
}

export interface GenerationSummary { created: number; skipped: number; }

/**
 * Genera los pedidos de las suscripciones vencidas de UN tenant. Idempotencia práctica: al
 * generar (o fallar) se avanza `next_run_at` un intervalo, así el próximo corte no la re-toma.
 * Si falta precio o stock, salta el ciclo (registra `last_error`) y no rompe el resto.
 */
export async function generateDueOrdersForTenant(db: TenantAwareDb, tenantId: string): Promise<GenerationSummary> {
  const due = await db.withTenant(tenantId, (tx) => listDueSubscriptions(tx));
  let created = 0;
  let skipped = 0;

  for (const s of due) {
    if (s.priceMinor === null) {
      await db.withTenant(tenantId, (tx) => advanceSubscription(tx, s.id, { error: "sin_precio" }));
      skipped++;
      continue;
    }
    if (s.available < s.qty) {
      await db.withTenant(tenantId, (tx) => advanceSubscription(tx, s.id, { error: "sin_stock" }));
      skipped++;
      continue;
    }

    const unit = s.discountPercent > 0 ? s.priceMinor - (s.priceMinor * BigInt(s.discountPercent)) / 100n : s.priceMinor;
    const ship: Record<string, unknown> = {};
    if (s.shipStreet) ship.street = s.shipStreet;
    if (s.shipZone) ship.zone = s.shipZone;
    if (s.shipPhone) ship.phone = s.shipPhone;
    if (s.shipNotes) ship.notes = s.shipNotes;
    if (s.shipLat != null) ship.lat = s.shipLat;
    if (s.shipLng != null) ship.lng = s.shipLng;

    const createdOrder = await createOrder(db, {
      tenantId,
      ...(s.customerId ? { customerId: s.customerId } : {}),
      currency: s.currency ?? "ARS",
      channel: "suscripcion",
      paymentMethod: s.paymentMethod as PaymentMethod,
      paymentStatus: "pendiente",
      ...(s.petId ? { petId: s.petId } : {}),
      ...(s.petName ? { petName: s.petName } : {}),
      ...(Object.keys(ship).length > 0 ? { shippingAddress: ship } : {}),
      deliveryChargeMinor: 0n, // envío incluido: perk de suscripción (v1)
      sellers: [{ merchantId: s.merchantId, items: [{ variantId: s.variantId, qty: s.qty, unitPriceMinor: unit }] }],
    });

    if (createdOrder.ok) {
      await db.withTenant(tenantId, (tx) => advanceSubscription(tx, s.id, { orderId: createdOrder.value.orderId }));
      created++;
    } else {
      await db.withTenant(tenantId, (tx) => advanceSubscription(tx, s.id, { error: createdOrder.error }));
      skipped++;
    }
  }

  return { created, skipped };
}
