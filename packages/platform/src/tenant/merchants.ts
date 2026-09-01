import { type Result, ok, err } from "@commerce/contracts";
import type { Db, TenantAwareDb } from "../db/port.js";

export interface MerchantRow {
  id: string;
  slug: string;
  name: string;
}

/**
 * Da de alta un comercio dentro de un tenant (paso previo al marketplace: varios
 * comercios por tenant). Corre con contexto de tenant → la política WITH CHECK valida
 * que el comercio quede atado a ESE tenant. Slug único por tenant.
 */
export async function createMerchant(
  db: TenantAwareDb,
  input: { tenantId: string; slug: string; name: string; regionId?: string },
): Promise<Result<{ merchantId: string }, string>> {
  try {
    const id = await db.withTenant(input.tenantId, async (tx) => {
      const [m] = await tx.query<{ id: string }>(
        `insert into merchants (tenant_id, region_id, slug, name) values ($1,$2,$3,$4) returning id`,
        [input.tenantId, input.regionId ?? null, input.slug, input.name],
      );
      return m!.id;
    });
    return ok({ merchantId: id });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** Lista los comercios del tenant activo (correr dentro de withTenant). */
export async function listMerchants(db: Db): Promise<MerchantRow[]> {
  const rows = await db.query<{ id: string; slug: string; name: string }>(
    `select id, slug, name from merchants order by created_at`,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
}
