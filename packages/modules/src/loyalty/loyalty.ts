import { type Db, resolveConfigValue, enqueueEvent } from "@commerce/platform";
import { type Result, ok, err } from "@commerce/contracts";

// ── Club de puntos ─────────────────────────────────────────────────────────────────
// El cliente suma puntos con cada pedido ENTREGADO (y con compras en el local que carga el
// comercio) y los canjea por premios que define el comercio. El canje se hace desde el panel:
// el comercio identifica a la persona (en la tienda, cualquiera puede escribir un teléfono
// ajeno). Las reglas son config (`features.loyalty`, `loyalty.spendPerPointMinor`), no código.
// Todas las funciones corren con contexto de tenant (withTenant → RLS).

export type MovementKind = "earn" | "store" | "redeem" | "adjust";

export interface LoyaltyRule {
  enabled: boolean;
  /** Cuánto hay que gastar (en centavos) para sumar 1 punto. */
  spendPerPointMinor: bigint;
}

export interface LoyaltyMovement {
  id: string;
  points: number;
  kind: MovementKind;
  orderId: string | null;
  rewardName: string | null;
  note: string | null;
  createdAt: string;
}

export interface LoyaltyReward {
  id: string;
  name: string;
  pointsCost: number;
  active: boolean;
}

export async function loyaltyRule(db: Db, tenantId: string): Promise<LoyaltyRule> {
  const chain = { tenantId };
  const [enabled, spend] = await Promise.all([
    resolveConfigValue<boolean>(db, "features.loyalty", chain),
    resolveConfigValue<number>(db, "loyalty.spendPerPointMinor", chain),
  ]);
  return { enabled: enabled.value === true, spendPerPointMinor: BigInt(Math.max(1, Math.trunc(Number(spend.value) || 1))) };
}

/** Puntos que corresponden a un gasto (redondeo hacia abajo: $1.999 con 1 punto c/$1.000 = 1). */
export function pointsForSpend(amountMinor: bigint, spendPerPointMinor: bigint): number {
  if (amountMinor <= 0n || spendPerPointMinor <= 0n) return 0;
  return Number(amountMinor / spendPerPointMinor);
}

/**
 * Suma los puntos de un pedido entregado. Va dentro de la tx que lo completa. Idempotente
 * (un 'earn' por pedido, por índice único). Sin cliente identificado o con el club apagado, no
 * suma. Se cuenta solo lo gastado en productos (`total_minor`, sin envío). Devuelve los puntos.
 */
export async function awardOrderPoints(db: Db, tenantId: string, orderId: string): Promise<number> {
  const rule = await loyaltyRule(db, tenantId);
  if (!rule.enabled) return 0;
  const [o] = await db.query<{ customer_id: string | null; total_minor: string }>(
    `select customer_id, total_minor::text from orders where id = $1`,
    [orderId],
  );
  if (!o?.customer_id) return 0;
  const points = pointsForSpend(BigInt(o.total_minor), rule.spendPerPointMinor);
  if (points <= 0) return 0;
  const rows = await db.query<{ id: string }>(
    `insert into loyalty_movements (tenant_id, customer_id, points, kind, order_id)
     values ($1, $2, $3, 'earn', $4)
     on conflict (order_id) where kind = 'earn' do nothing
     returning id`,
    [tenantId, o.customer_id, points, orderId],
  );
  if (rows.length === 0) return 0;
  await enqueueEvent(db, { tenantId, type: "loyalty.earned", payload: { orderId, customerId: o.customer_id, points } });
  return points;
}

/** Puntos que sumó un pedido (para el seguimiento: "Con este pedido sumaste N puntos"). */
export async function orderPointsEarned(db: Db, orderId: string): Promise<number> {
  const [r] = await db.query<{ points: number }>(
    `select points from loyalty_movements where order_id = $1 and kind = 'earn'`,
    [orderId],
  );
  return r ? Number(r.points) : 0;
}

export async function loyaltyBalance(db: Db, customerId: string): Promise<number> {
  const [r] = await db.query<{ total: number }>(
    `select coalesce(sum(points), 0)::int as total from loyalty_movements where customer_id = $1`,
    [customerId],
  );
  return Number(r?.total ?? 0);
}

export async function loyaltyHistory(db: Db, customerId: string, limit = 30): Promise<LoyaltyMovement[]> {
  const rows = await db.query<{
    id: string; points: number; kind: MovementKind; order_id: string | null; reward_name: string | null; note: string | null; created_at: string;
  }>(
    `select m.id, m.points, m.kind, m.order_id, r.name as reward_name, m.note, m.created_at
       from loyalty_movements m left join loyalty_rewards r on r.id = m.reward_id
      where m.customer_id = $1
      order by m.created_at desc
      limit $2`,
    [customerId, Math.min(Math.max(1, limit), 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    points: Number(r.points),
    kind: r.kind,
    orderId: r.order_id,
    rewardName: r.reward_name,
    note: r.note,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/**
 * Movimiento manual desde el panel: `store` (compra en el local: suma lo que da el monto según
 * la regla) o `adjust` (± puntos con motivo). Nunca deja el saldo en negativo. Bloquea la ficha
 * del cliente para que dos operaciones simultáneas no se pisen el saldo.
 */
export async function addLoyaltyPoints(
  db: Db,
  input: { tenantId: string; customerId: string; kind: "store" | "adjust"; points?: number; amountMinor?: bigint; note?: string },
): Promise<Result<{ points: number; balance: number }, string>> {
  const rule = await loyaltyRule(db, input.tenantId);
  if (!rule.enabled) return err("loyalty_disabled");
  let points: number;
  if (input.kind === "store") {
    if (input.amountMinor === undefined || input.amountMinor <= 0n) return err("invalid_amount");
    points = pointsForSpend(input.amountMinor, rule.spendPerPointMinor);
    if (points <= 0) return err("amount_too_low");
  } else {
    points = Math.trunc(Number(input.points));
    if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 1_000_000) return err("invalid_points");
    if (!input.note?.trim()) return err("note_required");
  }
  if (!(await lockCustomer(db, input.customerId))) return err("customer_not_found");
  const balance = await loyaltyBalance(db, input.customerId);
  if (balance + points < 0) return err("insufficient_points");
  await db.query(
    `insert into loyalty_movements (tenant_id, customer_id, points, kind, note) values ($1, $2, $3, $4, $5)`,
    [input.tenantId, input.customerId, points, input.kind, input.note?.trim().slice(0, 200) || null],
  );
  return ok({ points, balance: balance + points });
}

/** Canje de un premio: descuenta su costo si alcanza el saldo. El comercio entrega el premio. */
export async function redeemReward(
  db: Db,
  input: { tenantId: string; customerId: string; rewardId: string },
): Promise<Result<{ points: number; balance: number; reward: string }, string>> {
  const rule = await loyaltyRule(db, input.tenantId);
  if (!rule.enabled) return err("loyalty_disabled");
  const [reward] = await db.query<{ name: string; points_cost: number; active: boolean }>(
    `select name, points_cost, active from loyalty_rewards where id = $1`,
    [input.rewardId],
  );
  if (!reward || !reward.active) return err("reward_not_found");
  if (!(await lockCustomer(db, input.customerId))) return err("customer_not_found");
  const balance = await loyaltyBalance(db, input.customerId);
  const cost = Number(reward.points_cost);
  if (balance < cost) return err("insufficient_points");
  await db.query(
    `insert into loyalty_movements (tenant_id, customer_id, points, kind, reward_id) values ($1, $2, $3, 'redeem', $4)`,
    [input.tenantId, input.customerId, -cost, input.rewardId],
  );
  await enqueueEvent(db, { tenantId: input.tenantId, type: "loyalty.redeemed", payload: { customerId: input.customerId, rewardId: input.rewardId, points: cost } });
  return ok({ points: -cost, balance: balance - cost, reward: reward.name });
}

async function lockCustomer(db: Db, customerId: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(`select id from customers where id = $1 for update`, [customerId]);
  return rows.length > 0;
}

// ── Premios ─────────────────────────────────────────────────────────────────────────
export async function listRewards(db: Db, opts: { activeOnly?: boolean } = {}): Promise<LoyaltyReward[]> {
  const rows = await db.query<{ id: string; name: string; points_cost: number; active: boolean }>(
    `select id, name, points_cost, active from loyalty_rewards
      ${opts.activeOnly ? "where active" : ""}
      order by active desc, points_cost asc, created_at asc`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, pointsCost: Number(r.points_cost), active: r.active }));
}

/** Crea o edita un premio (sin `id` = nuevo). Desactivar en vez de borrar: el historial lo referencia. */
export async function saveReward(
  db: Db,
  input: { tenantId: string; id?: string; name: string; pointsCost: number; active?: boolean },
): Promise<Result<LoyaltyReward, string>> {
  const name = input.name?.trim() ?? "";
  const cost = Math.trunc(Number(input.pointsCost));
  if (!name || name.length > 120) return err("invalid_name");
  if (!Number.isFinite(cost) || cost <= 0 || cost > 1_000_000) return err("invalid_points");
  const rows = input.id
    ? await db.query<{ id: string; name: string; points_cost: number; active: boolean }>(
        `update loyalty_rewards set name = $2, points_cost = $3, active = $4 where id = $1
         returning id, name, points_cost, active`,
        [input.id, name, cost, input.active !== false],
      )
    : await db.query<{ id: string; name: string; points_cost: number; active: boolean }>(
        `insert into loyalty_rewards (tenant_id, name, points_cost, active) values ($1, $2, $3, $4)
         returning id, name, points_cost, active`,
        [input.tenantId, name, cost, input.active !== false],
      );
  const r = rows[0];
  if (!r) return err("reward_not_found");
  return ok({ id: r.id, name: r.name, pointsCost: Number(r.points_cost), active: r.active });
}

/** Clientes con más puntos (para el panel). */
export async function topLoyaltyCustomers(
  db: Db,
  limit = 20,
): Promise<Array<{ customerId: string; name: string | null; phone: string | null; balance: number }>> {
  const rows = await db.query<{ id: string; name: string | null; phone: string | null; balance: number }>(
    `select c.id, c.name, c.phone, sum(m.points)::int as balance
       from loyalty_movements m join customers c on c.id = m.customer_id
      group by c.id, c.name, c.phone
     having sum(m.points) > 0
      order by balance desc
      limit $1`,
    [Math.min(Math.max(1, limit), 100)],
  );
  return rows.map((r) => ({ customerId: r.id, name: r.name, phone: r.phone, balance: Number(r.balance) }));
}
