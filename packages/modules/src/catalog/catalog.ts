import type { Db } from "@commerce/platform";
import type { Money, CurrencyCode } from "@commerce/contracts";

/**
 * Módulo Catálogo. Opera SIEMPRE con el `Db` de una transacción de tenant (withTenant):
 * RLS garantiza que solo toca datos del tenant activo. Precios versionados por
 * `effective_from`; el "precio actual" es el último vigente.
 */

export interface CreateProductInput {
  tenantId: string;
  merchantId: string;
  slug: string;
  name: string;
  description?: string;
}

export async function createProduct(db: Db, input: CreateProductInput): Promise<{ productId: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into products (tenant_id, merchant_id, slug, name, description)
     values ($1,$2,$3,$4,$5) returning id`,
    [input.tenantId, input.merchantId, input.slug, input.name, input.description ?? null],
  );
  return { productId: row!.id };
}

export async function addVariant(
  db: Db,
  input: { tenantId: string; productId: string; sku: string; name: string },
): Promise<{ variantId: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into variants (tenant_id, product_id, sku, name) values ($1,$2,$3,$4) returning id`,
    [input.tenantId, input.productId, input.sku, input.name],
  );
  return { variantId: row!.id };
}

/** Fija un nuevo precio vigente para una variante (nueva fila, versionado por fecha). */
export async function setPrice(
  db: Db,
  input: { tenantId: string; variantId: string; amountMinor: bigint; currency?: CurrencyCode; effectiveFrom?: Date },
): Promise<void> {
  await db.query(
    `insert into prices (tenant_id, variant_id, amount_minor, currency, effective_from)
     values ($1,$2,$3,$4,$5)`,
    [
      input.tenantId,
      input.variantId,
      input.amountMinor.toString(),
      input.currency ?? "ARS",
      (input.effectiveFrom ?? new Date()).toISOString(),
    ],
  );
}

export interface VariantWithPrice {
  variantId: string;
  productId: string;
  /** Nombre del producto (presente en listCatalog; opcional en lecturas por variante). */
  productName?: string;
  sku: string;
  name: string;
  price: Money | null;
}

/** Variante + su precio ACTUAL (último vigente a `at`). Base para re-cotizar recompras ([U2]). */
export async function getVariantWithPrice(
  db: Db,
  variantId: string,
  at?: Date,
): Promise<VariantWithPrice | null> {
  const [row] = await db.query<{
    variant_id: string;
    product_id: string;
    sku: string;
    name: string;
    amount_minor: string | null;
    currency: CurrencyCode | null;
  }>(
    `select v.id as variant_id, v.product_id, v.sku, v.name,
            p.amount_minor, p.currency
       from variants v
       left join lateral (
         select amount_minor, currency from prices
          where variant_id = v.id and effective_from <= $2
          order by effective_from desc limit 1
       ) p on true
      where v.id = $1`,
    [variantId, (at ?? new Date()).toISOString()],
  );
  if (!row) return null;
  return {
    variantId: row.variant_id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    price:
      row.amount_minor !== null
        ? { amountMinor: BigInt(row.amount_minor), currency: row.currency ?? "ARS" }
        : null,
  };
}

export interface CatalogAdminRow {
  variantId: string;
  productId: string;
  productName: string;
  productStatus: string;
  variantName: string;
  sku: string;
  priceMinor: bigint | null;
  currency: CurrencyCode | null;
  available: number;
}

/**
 * Vista de catálogo para el PANEL del comercio: incluye stock y productos inactivos
 * (a diferencia de listCatalog, que es la vista del cliente). Correr con contexto de tenant.
 */
export async function listCatalogAdmin(db: Db, merchantId: string): Promise<CatalogAdminRow[]> {
  const rows = await db.query<{
    variant_id: string;
    product_id: string;
    product_name: string;
    product_status: string;
    variant_name: string;
    sku: string;
    amount_minor: string | null;
    currency: CurrencyCode | null;
    available: number;
  }>(
    `select v.id as variant_id, v.product_id, pr.name as product_name, pr.status as product_status,
            v.name as variant_name, v.sku, p.amount_minor, p.currency, coalesce(inv.available,0) as available
       from variants v
       join products pr on pr.id = v.product_id
       left join lateral (
         select amount_minor, currency from prices where variant_id = v.id and effective_from <= now()
         order by effective_from desc limit 1
       ) p on true
       left join inventory inv on inv.variant_id = v.id
      where pr.merchant_id = $1
      order by pr.name, v.name`,
    [merchantId],
  );
  return rows.map((r) => ({
    variantId: r.variant_id,
    productId: r.product_id,
    productName: r.product_name,
    productStatus: r.product_status,
    variantName: r.variant_name,
    sku: r.sku,
    priceMinor: r.amount_minor !== null ? BigInt(r.amount_minor) : null,
    currency: r.currency,
    available: r.available,
  }));
}

/** Lista el catálogo activo de un merchant (variantes con precio actual). */
export async function listCatalog(
  db: Db,
  merchantId: string,
  at?: Date,
): Promise<VariantWithPrice[]> {
  const rows = await db.query<{
    variant_id: string;
    product_id: string;
    product_name: string;
    sku: string;
    name: string;
    amount_minor: string | null;
    currency: CurrencyCode | null;
  }>(
    `select v.id as variant_id, v.product_id, pr.name as product_name, v.sku, v.name, p.amount_minor, p.currency
       from variants v
       join products pr on pr.id = v.product_id and pr.status = 'active'
       left join lateral (
         select amount_minor, currency from prices
          where variant_id = v.id and effective_from <= $2
          order by effective_from desc limit 1
       ) p on true
      where pr.merchant_id = $1
      order by pr.name, v.name`,
    [merchantId, (at ?? new Date()).toISOString()],
  );
  return rows.map((row) => ({
    variantId: row.variant_id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    name: row.name,
    price:
      row.amount_minor !== null
        ? { amountMinor: BigInt(row.amount_minor), currency: row.currency ?? "ARS" }
        : null,
  }));
}
