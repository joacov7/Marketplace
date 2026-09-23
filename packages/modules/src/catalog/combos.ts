import type { Db } from "@commerce/platform";
import type { CurrencyCode } from "@commerce/contracts";

/**
 * Combos / Cajas: bundles con nombre propio que agrupan varios productos con su cantidad. El
 * precio es la suma de sus ítems al precio vigente (el checkout re-precia por ítem, así que el
 * combo no inventa un precio: para un descuento, poné los productos en oferta). Todo por comercio
 * y bajo RLS. Estas funciones corren dentro de un contexto de tenant (withTenant).
 */

export interface ComboItemAdmin {
  variantId: string;
  qty: number;
  variantName: string;
  productName: string;
}
export interface ComboAdmin {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  position: number;
  items: ComboItemAdmin[];
}

export interface ComboStoreItem {
  variantId: string;
  name: string; // producto (+ talle si aporta)
  sub: string; // talle · categoría-ish
  priceMinor: bigint | null;
  qty: number;
  available: number;
}
export interface ComboStore {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  items: ComboStoreItem[];
  /** Suma de (precio × cantidad) de los ítems con precio, en centavos. */
  priceMinor: bigint;
  currency: CurrencyCode;
  /** true = todos los ítems tienen precio y stock suficiente para armar el combo. */
  inStock: boolean;
}

export async function createCombo(
  db: Db,
  input: { tenantId: string; merchantId: string; name: string; description?: string; imageUrl?: string; position?: number },
): Promise<{ comboId: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into combos (tenant_id, merchant_id, name, description, image_url, position)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [input.tenantId, input.merchantId, input.name, input.description ?? null, input.imageUrl ?? null, input.position ?? 0],
  );
  return { comboId: row!.id };
}

export async function updateCombo(
  db: Db,
  input: { comboId: string; name?: string; description?: string | null; imageUrl?: string | null; active?: boolean; position?: number },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [input.comboId];
  if (input.name !== undefined) { params.push(input.name); sets.push(`name = $${params.length}`); }
  if (input.description !== undefined) { params.push(input.description); sets.push(`description = $${params.length}`); }
  if (input.imageUrl !== undefined) { params.push(input.imageUrl); sets.push(`image_url = $${params.length}`); }
  if (input.active !== undefined) { params.push(input.active); sets.push(`active = $${params.length}`); }
  if (input.position !== undefined) { params.push(input.position); sets.push(`position = $${params.length}`); }
  if (sets.length === 0) return;
  await db.query(`update combos set ${sets.join(", ")} where id = $1`, params);
}

export async function deleteCombo(db: Db, comboId: string): Promise<void> {
  await db.query(`delete from combo_items where combo_id = $1`, [comboId]);
  await db.query(`delete from combos where id = $1`, [comboId]);
}

/** Reemplaza los ítems del combo por la lista provista (variantId + qty). */
export async function setComboItems(
  db: Db,
  input: { tenantId: string; comboId: string; items: Array<{ variantId: string; qty: number }> },
): Promise<void> {
  await db.query(`delete from combo_items where combo_id = $1`, [input.comboId]);
  for (const it of input.items) {
    const qty = Math.max(1, Math.floor(it.qty));
    await db.query(
      `insert into combo_items (tenant_id, combo_id, variant_id, qty) values ($1,$2,$3,$4)`,
      [input.tenantId, input.comboId, it.variantId, qty],
    );
  }
}

/** Combos del comercio con sus ítems (para el panel). Incluye inactivos. */
export async function listCombosAdmin(db: Db, merchantId: string): Promise<ComboAdmin[]> {
  const rows = await db.query<{
    id: string; name: string; description: string | null; image_url: string | null; active: boolean; position: number;
    variant_id: string | null; qty: number | null; variant_name: string | null; product_name: string | null;
  }>(
    `select c.id, c.name, c.description, c.image_url, c.active, c.position,
            ci.variant_id, ci.qty, v.name as variant_name, pr.name as product_name
       from combos c
       left join combo_items ci on ci.combo_id = c.id
       left join variants v on v.id = ci.variant_id
       left join products pr on pr.id = v.product_id
      where c.merchant_id = $1
      order by c.position, c.created_at, pr.name`,
    [merchantId],
  );
  const byId = new Map<string, ComboAdmin>();
  for (const r of rows) {
    let c = byId.get(r.id);
    if (!c) { c = { id: r.id, name: r.name, description: r.description, imageUrl: r.image_url, active: r.active, position: r.position, items: [] }; byId.set(r.id, c); }
    if (r.variant_id) c.items.push({ variantId: r.variant_id, qty: r.qty ?? 1, variantName: r.variant_name ?? "", productName: r.product_name ?? "" });
  }
  return [...byId.values()];
}

/** Combos ACTIVOS con precio y stock (para la tienda). */
export async function listCombosStore(db: Db, merchantId: string): Promise<ComboStore[]> {
  const rows = await db.query<{
    id: string; name: string; description: string | null; image_url: string | null;
    variant_id: string; qty: number; variant_name: string; product_name: string;
    category_name: string | null; amount_minor: string | null; currency: CurrencyCode | null; available: number;
  }>(
    `select c.id, c.name, c.description, c.image_url,
            ci.variant_id, ci.qty, v.name as variant_name, pr.name as product_name,
            cat.name as category_name, p.amount_minor, p.currency,
            coalesce(inv.available, 0) as available
       from combos c
       join combo_items ci on ci.combo_id = c.id
       join variants v on v.id = ci.variant_id
       join products pr on pr.id = v.product_id and pr.status = 'active'
       left join categories cat on cat.id = pr.category_id
       left join lateral (
         select amount_minor, currency from prices
          where variant_id = v.id and effective_from <= now()
          order by effective_from desc limit 1
       ) p on true
       left join inventory inv on inv.variant_id = v.id
      where c.merchant_id = $1 and c.active = true
      order by c.position, c.created_at, pr.name`,
    [merchantId],
  );
  const byId = new Map<string, ComboStore>();
  for (const r of rows) {
    let c = byId.get(r.id);
    if (!c) { c = { id: r.id, name: r.name, description: r.description, imageUrl: r.image_url, items: [], priceMinor: 0n, currency: "ARS", inStock: true }; byId.set(r.id, c); }
    const price = r.amount_minor !== null ? BigInt(r.amount_minor) : null;
    const label = r.variant_name && r.variant_name !== "Único" ? `${r.product_name} ${r.variant_name}` : r.product_name;
    c.items.push({ variantId: r.variant_id, name: label, sub: `${r.variant_name} · ${r.category_name ?? "Producto"}`, priceMinor: price, qty: r.qty, available: r.available });
    if (r.currency) c.currency = r.currency;
    if (price !== null) c.priceMinor += price * BigInt(r.qty);
    if (price === null || r.available < r.qty) c.inStock = false;
  }
  // Un combo sin ítems no llega acá (el join los excluye), así que todos tienen al menos uno.
  return [...byId.values()];
}
