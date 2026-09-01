import { resolveConfigValue } from "@commerce/platform";
import { listCatalog } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import Storefront, { type StoreProduct } from "./storefront";

export const dynamic = "force-dynamic"; // depende del tenant resuelto por request

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>{children}</main>;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <div style={{ marginTop: "8vh", textAlign: "center" }}>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        <div style={{ color: "#666", lineHeight: 1.6 }}>{children}</div>
      </div>
    </Shell>
  );
}

export default async function Home({ searchParams }: { searchParams: { tenant?: string } }) {
  let tenant;
  try {
    tenant = await resolveTenant(searchParams?.tenant ?? null);
  } catch (e) {
    console.error("[home] error resolviendo tenant/DB:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>
          No se pudo conectar a la base o leer los datos. Verificá que <code>DATABASE_URL</code> esté seteada en Vercel y
          que hayas corrido las migraciones (<code>/api/admin/migrate</code>). Probá <code>/api/health</code>.
        </p>
      </Notice>
    );
  }

  if (!tenant) {
    return (
      <Notice title="Commerce OS">
        <p>
          No se resolvió ningún comercio para este dominio. Accedé por el subdominio del tenant
          (p. ej. <code>gualeguay.tudominio.com</code>) o agregá <code>?tenant=gualeguay</code> a la URL.
        </p>
      </Notice>
    );
  }

  try {
    const [primary, displayName, agentEnabled, catalog] = await Promise.all([
      resolveConfigValue<string>(db(), "branding.primaryColor", { tenantId: tenant.tenantId }).then((r) => r.value),
      resolveConfigValue<string>(db(), "branding.displayName", { tenantId: tenant.tenantId }).then((r) => r.value),
      resolveConfigValue<boolean>(db(), "features.customerAgent", { tenantId: tenant.tenantId }).then((r) => r.value),
      db().withTenant(tenant.tenantId, async (tx) => {
        const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
        if (!merchants[0]) return [];
        return listCatalog(tx, merchants[0].id);
      }),
    ]);

    const products: StoreProduct[] = catalog.map((v) => ({
      variantId: v.variantId,
      name: v.name,
      sku: v.sku,
      priceMinor: v.price ? v.price.amountMinor.toString() : null,
      currency: v.price?.currency ?? null,
    }));

    return (
      <Storefront
        tenant={tenant.slug}
        displayName={displayName}
        primary={primary}
        agentEnabled={agentEnabled}
        products={products}
      />
    );
  } catch (e) {
    console.error("[home] error leyendo config/catálogo:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>El comercio se resolvió pero no se pudieron leer sus datos. Puede faltar correr las migraciones o el seed.</p>
      </Notice>
    );
  }
}
