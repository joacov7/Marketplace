import { resolveConfigValue } from "@commerce/platform";
import { listCatalog, type VariantWithPrice } from "@commerce/modules/catalog";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic"; // depende del tenant resuelto por request

function formatMoney(v: VariantWithPrice): string {
  if (!v.price) return "—";
  const pesos = Number(v.price.amountMinor) / 100;
  return pesos.toLocaleString("es-AR", { style: "currency", currency: v.price.currency });
}

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

export default async function Home() {
  // La home degrada con un diagnóstico en vez de tirar un 500 si la base no está lista.
  let tenant;
  try {
    tenant = await resolveTenant();
  } catch (e) {
    console.error("[home] error resolviendo tenant/DB:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>
          No se pudo conectar a la base o leer los datos. Verificá que <code>DATABASE_URL</code> esté
          seteada en Vercel y que hayas corrido las migraciones (<code>npm run migrate</code>).
        </p>
        <p>
          Probá <code>/api/health</code> para ver el estado de la base.
        </p>
      </Notice>
    );
  }

  if (!tenant) {
    return (
      <Notice title="Commerce OS">
        <p>
          No se resolvió ningún comercio para este dominio. Accedé por el subdominio del tenant
          (p. ej. <code>gualeguay.tudominio.com</code>) o pasá el header <code>x-tenant</code> en
          desarrollo. Creá el primero con <code>POST /api/admin/tenants</code> o el seed de demo.
        </p>
      </Notice>
    );
  }

  try {
    const primary = (await resolveConfigValue<string>(db(), "branding.primaryColor", { tenantId: tenant.tenantId })).value;
    const displayName = (await resolveConfigValue<string>(db(), "branding.displayName", { tenantId: tenant.tenantId })).value;
    const agentEnabled = (await resolveConfigValue<boolean>(db(), "features.customerAgent", { tenantId: tenant.tenantId })).value;

    const catalog = await db().withTenant(tenant.tenantId, async (tx) => {
      const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
      if (!merchants[0]) return [] as VariantWithPrice[];
      return listCatalog(tx, merchants[0].id);
    });

    return (
      <Shell>
        <header style={{ background: primary, color: "white", padding: "20px 16px", borderRadius: 12, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>{displayName}</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.9 }}>¿Qué necesitás para tu mascota?</p>
          {agentEnabled && (
            <button
              style={{ marginTop: 12, background: "white", color: primary, border: "none", borderRadius: 999, padding: "8px 16px", fontWeight: 600 }}
            >
              🐾 Preguntar al agente
            </button>
          )}
        </header>

        <section>
          <h2 style={{ fontSize: 16, color: "#444" }}>Productos</h2>
          {catalog.length === 0 ? (
            <p style={{ color: "#888" }}>Este comercio todavía no cargó productos.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
              {catalog.map((v) => (
                <li
                  key={v.variantId}
                  style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span>
                    <strong>{v.name}</strong>
                    <span style={{ color: "#999", marginLeft: 8, fontSize: 13 }}>{v.sku}</span>
                  </span>
                  <span style={{ fontWeight: 600 }}>{formatMoney(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer style={{ marginTop: 32, color: "#aaa", fontSize: 12, textAlign: "center" }}>{tenant.name} · Commerce OS</footer>
      </Shell>
    );
  } catch (e) {
    console.error("[home] error leyendo config/catálogo:", e);
    return (
      <Notice title="Configuración pendiente">
        <p>
          El comercio se resolvió pero no se pudieron leer sus datos. Puede faltar correr las
          migraciones o sembrar el tenant. Revisá los logs y <code>/api/health</code>.
        </p>
      </Notice>
    );
  }
}
