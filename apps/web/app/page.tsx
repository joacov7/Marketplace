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

export default async function Home() {
  const tenant = await resolveTenant();

  if (!tenant) {
    return (
      <main style={{ maxWidth: 640, margin: "10vh auto", padding: 24, textAlign: "center" }}>
        <h1>Commerce OS</h1>
        <p style={{ color: "#666" }}>
          No se resolvió ningún comercio para este dominio. Accedé por el subdominio del tenant
          (p. ej. <code>gualeguay.tudominio.com</code>) o pasá el header <code>x-tenant</code> en desarrollo.
        </p>
      </main>
    );
  }

  const primary = (await resolveConfigValue<string>(db(), "branding.primaryColor", { tenantId: tenant.tenantId })).value;
  const displayName = (await resolveConfigValue<string>(db(), "branding.displayName", { tenantId: tenant.tenantId })).value;
  const agentEnabled = (await resolveConfigValue<boolean>(db(), "features.customerAgent", { tenantId: tenant.tenantId })).value;

  // V1: un pet shop propio. Tomamos el primer merchant del tenant y su catálogo.
  const catalog = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return [] as VariantWithPrice[];
    return listCatalog(tx, merchants[0].id);
  });

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <header
        style={{
          background: primary,
          color: "white",
          padding: "20px 16px",
          borderRadius: 12,
          marginBottom: 20,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22 }}>{displayName}</h1>
        <p style={{ margin: "6px 0 0", opacity: 0.9 }}>¿Qué necesitás para tu mascota?</p>
        {agentEnabled && (
          <button
            style={{
              marginTop: 12,
              background: "white",
              color: primary,
              border: "none",
              borderRadius: 999,
              padding: "8px 16px",
              fontWeight: 600,
            }}
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
                style={{
                  background: "white",
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
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

      <footer style={{ marginTop: 32, color: "#aaa", fontSize: 12, textAlign: "center" }}>
        {tenant.name} · Commerce OS
      </footer>
    </main>
  );
}
