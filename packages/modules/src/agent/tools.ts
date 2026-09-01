import type { Db } from "@commerce/platform";
import type { CurrencyCode } from "@commerce/contracts";
import type { ProductHit, RepurchaseHit, ProposedCart, ProposedCartItem } from "./types.js";

/** Tool `buscar_producto`: catálogo activo que matchea el texto, con precio y stock. */
export async function searchProducts(
  db: Db,
  input: { query: string; limit?: number; inStockOnly?: boolean },
): Promise<ProductHit[]> {
  const rows = await db.query<{
    variant_id: string;
    name: string;
    product_name: string;
    amount_minor: string | null;
    currency: CurrencyCode | null;
    available: number;
  }>(
    `select v.id as variant_id, v.name, pr.name as product_name, p.amount_minor, p.currency,
            coalesce(inv.available, 0) as available
       from variants v
       join products pr on pr.id = v.product_id and pr.status = 'active'
       left join lateral (
         select amount_minor, currency from prices
          where variant_id = v.id and effective_from <= now()
          order by effective_from desc limit 1
       ) p on true
       left join inventory inv on inv.variant_id = v.id
      where (v.name ilike $1 or pr.name ilike $1)
      order by v.name
      limit $2`,
    [`%${input.query}%`, input.limit ?? 20],
  );
  const hits = rows.map((r) => ({
    variantId: r.variant_id,
    name: r.name,
    productName: r.product_name,
    priceMinor: r.amount_minor !== null ? BigInt(r.amount_minor) : null,
    currency: r.currency,
    available: r.available,
  }));
  return input.inStockOnly ? hits.filter((h) => h.available > 0) : hits;
}

/** Tool `detectar_recompra`: variantes que el cliente ya compró (pedidos confirmados+). */
export async function detectRepurchase(db: Db, customerId: string): Promise<RepurchaseHit[]> {
  const rows = await db.query<{ variant_id: string; name: string; times: string; last_at: string }>(
    `select oi.variant_id, v.name, count(*)::text as times, max(o.created_at) as last_at
       from order_items oi
       join seller_orders so on so.id = oi.seller_order_id
       join orders o on o.id = so.order_id
       join variants v on v.id = oi.variant_id
      where o.customer_id = $1 and o.status in ('confirmed','completed','partially_refunded')
      group by oi.variant_id, v.name
      order by max(o.created_at) desc`,
    [customerId],
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    name: r.name,
    times: Number(r.times),
    lastAt: new Date(r.last_at).toISOString(),
  }));
}

/** Tool `recomendar`: recompra si hay historial; si no, primeros productos en stock. */
export async function recommend(db: Db, input: { customerId?: string; limit?: number }): Promise<ProductHit[]> {
  const limit = input.limit ?? 5;
  if (input.customerId) {
    const rep = await detectRepurchase(db, input.customerId);
    if (rep.length > 0) {
      const ids = rep.slice(0, limit).map((r) => r.variantId);
      return variantsByIds(db, ids);
    }
  }
  return searchProducts(db, { query: "", limit, inStockOnly: true });
}

async function variantsByIds(db: Db, ids: string[]): Promise<ProductHit[]> {
  if (ids.length === 0) return [];
  const rows = await db.query<{
    variant_id: string;
    name: string;
    product_name: string;
    amount_minor: string | null;
    currency: CurrencyCode | null;
    available: number;
  }>(
    `select v.id as variant_id, v.name, pr.name as product_name, p.amount_minor, p.currency,
            coalesce(inv.available,0) as available
       from variants v
       join products pr on pr.id = v.product_id
       left join lateral (
         select amount_minor, currency from prices where variant_id = v.id and effective_from <= now()
         order by effective_from desc limit 1
       ) p on true
       left join inventory inv on inv.variant_id = v.id
      where v.id = any($1::uuid[])`,
    [ids],
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    name: r.name,
    productName: r.product_name,
    priceMinor: r.amount_minor !== null ? BigInt(r.amount_minor) : null,
    currency: r.currency,
    available: r.available,
  }));
}

/**
 * Tool `armar_carrito` / `estimar_presupuesto`: PREPARA un carrito propuesto (inerte). Si
 * hay `budgetMinor`, incluye ítems mientras entren en el tope (respeta presupuesto). Marca
 * `withinBudget`. NO crea pedido ni pago.
 */
export async function assembleProposedCart(
  db: Db,
  input: { items: Array<{ variantId: string; qty: number }>; budgetMinor?: bigint; currency?: CurrencyCode },
): Promise<ProposedCart> {
  const currency: CurrencyCode = input.currency ?? "ARS";
  const chosen: ProposedCartItem[] = [];
  let total = 0n;

  for (const it of input.items) {
    const [row] = await db.query<{ name: string; amount_minor: string | null; available: number }>(
      `select v.name, p.amount_minor, coalesce(inv.available,0) as available
         from variants v
         left join lateral (
           select amount_minor from prices where variant_id = v.id and effective_from <= now()
           order by effective_from desc limit 1
         ) p on true
         left join inventory inv on inv.variant_id = v.id
        where v.id = $1`,
      [it.variantId],
    );
    if (!row || row.amount_minor === null || row.available < it.qty) continue; // sin precio o sin stock → se omite
    const lineTotal = BigInt(row.amount_minor) * BigInt(it.qty);
    if (input.budgetMinor !== undefined && total + lineTotal > input.budgetMinor) continue; // respeta presupuesto
    chosen.push({ variantId: it.variantId, name: row.name, qty: it.qty, unitPriceMinor: BigInt(row.amount_minor) });
    total += lineTotal;
  }

  return {
    items: chosen,
    totalMinor: total,
    currency,
    withinBudget: input.budgetMinor === undefined || total <= input.budgetMinor,
    budgetMinor: input.budgetMinor ?? null,
  };
}
