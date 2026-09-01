import { headers } from "next/headers";
import { db } from "./db";
import { tenantSlugFromHost } from "./tenant-slug";

export interface ResolvedTenant {
  tenantId: string;
  slug: string;
  name: string;
}

export { tenantSlugFromHost };

/**
 * Resuelve el tenant desde el borde: subdominio del Host (p. ej. `gualeguay.midominio.com`
 * → slug `gualeguay`), el header `x-tenant`, o un `explicitSlug` (query `?tenant=`) para
 * demos sin dominio propio. El id resuelto es el que alimenta `withTenant` / RLS. Si no
 * resuelve, el llamador debe fallar cerrado.
 */
export async function resolveTenant(explicitSlug?: string | null): Promise<ResolvedTenant | null> {
  const h = headers();
  const slug = explicitSlug || tenantSlugFromHost(h.get("host"), h.get("x-tenant"));
  if (!slug) return null;
  const rows = await db().query<{ id: string; slug: string; name: string }>(
    "select id, slug, name from tenants where slug = $1 and status = 'active'",
    [slug],
  );
  return rows[0] ? { tenantId: rows[0].id, slug: rows[0].slug, name: rows[0].name } : null;
}
