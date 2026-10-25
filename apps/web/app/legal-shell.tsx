import type { ShopLegal } from "@/lib/legal";

/** Marco simple de las páginas legales: encabezado con el comercio, contenido y datos legales. */
export function LegalShell({ shop, title, children }: { shop: ShopLegal; title: string; children: React.ReactNode }) {
  const home = `/?tenant=${encodeURIComponent(shop.tenant.slug)}`;
  return (
    <div style={{ minHeight: "100vh", background: "#f7f6f2", color: "#222", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e7e5df" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <a href={home} style={{ color: shop.primary, fontWeight: 700, fontSize: 17, textDecoration: "none" }}>{shop.displayName}</a>
          <a href={home} style={{ color: "#555", fontSize: 14, textDecoration: "none" }}>← Volver a la tienda</a>
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "26px 16px 48px" }}>
        <h1 style={{ fontSize: 26, margin: "0 0 18px", lineHeight: 1.2 }}>{title}</h1>
        {children}
        <LegalData shop={shop} />
      </main>
    </div>
  );
}

export function LegalData({ shop }: { shop: ShopLegal }) {
  const parts = [shop.businessName, shop.taxId && `CUIT ${shop.taxId}`, shop.address, shop.email].filter(Boolean);
  return <p style={{ marginTop: 32, fontSize: 12.5, color: "#777", lineHeight: 1.6 }}>{parts.join(" · ")}</p>;
}

export const proseStyle: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: "#333" };
