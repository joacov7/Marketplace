import { resolveConfigValue, type Db } from "@commerce/platform";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { cartHasFood, resolveMinOrderConfig, zoneChargeByName } from "@commerce/modules/delivery";
import { db } from "./db";

/**
 * Carrito: validación y precio. UNA sola implementación para la cotización (/api/checkout/quote)
 * y el checkout (/api/checkout), así lo que el cliente ve y lo que se cobra no pueden divergir.
 */

export const MAX_CART_LINES = 50;
export const MAX_QTY = 99;

export interface CartLine {
  variantId: string;
  qty: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida los ítems que manda el navegador: cantidades enteras 1..99, a lo sumo 50 líneas. */
export function parseCart(raw: unknown): { ok: true; items: CartLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "empty_cart" };
  if (raw.length > MAX_CART_LINES) return { ok: false, error: "too_many_items" };
  const items: CartLine[] = [];
  for (const it of raw as Array<{ variantId?: unknown; qty?: unknown }>) {
    const qty = Number(it?.qty);
    if (typeof it?.variantId !== "string" || !UUID.test(it.variantId) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, error: "invalid_item" };
    }
    items.push({ variantId: it.variantId, qty });
  }
  return { ok: true, items };
}

export type PricingConfig = Awaited<ReturnType<typeof loadPricingConfig>>;

/** Parámetros de precio del comercio (Configuration Engine, nunca hardcodeados). */
export async function loadPricingConfig(tenantId: string) {
  const chain = { tenantId };
  const big = (key: string) => resolveConfigValue<number>(db(), key, chain).then((r) => BigInt(r.value));
  const [freeOverMinor, standardMinor, auxilioMinor, transferPercent, minOrder] = await Promise.all([
    big("delivery.freeOverOrderTotalMinor"),
    big("delivery.customerChargeMinor"),
    big("delivery.auxilioCostMinor"),
    big("payments.transferDiscountPercent"),
    resolveMinOrderConfig(db(), tenantId),
  ]);
  return { freeOverMinor, standardMinor, auxilioMinor, transferPercent, minOrder };
}

/**
 * Precio actual de cada ítem + envío (zona del barrio si matchea, si no el estándar; gratis
 * sobre el umbral; el de Auxilio no tiene envío gratis). null si algún ítem no existe o no
 * tiene precio. Corre dentro de withTenant (RLS).
 */
export async function priceCart(
  tx: Db,
  cfg: PricingConfig,
  input: { items: CartLine[]; delivery: "estandar" | "auxilio"; zone?: string | null },
) {
  const lines: Array<CartLine & { unitPriceMinor: bigint }> = [];
  let gmv = 0n;
  for (const it of input.items) {
    const v = await getVariantWithPrice(tx, it.variantId);
    if (!v || !v.price) return null;
    lines.push({ ...it, unitPriceMinor: v.price.amountMinor });
    gmv += v.price.amountMinor * BigInt(it.qty);
  }
  const hasFood = await cartHasFood(tx, input.items.map((i) => i.variantId));
  const zone = input.zone ? await zoneChargeByName(tx, input.zone) : null;
  const deliveryChargeMinor =
    input.delivery === "auxilio" ? cfg.auxilioMinor : gmv >= cfg.freeOverMinor ? 0n : (zone?.customerChargeMinor ?? cfg.standardMinor);
  return { lines, gmv, deliveryChargeMinor, hasFood, zoneEtaMinutes: zone?.etaMinutes ?? null };
}
