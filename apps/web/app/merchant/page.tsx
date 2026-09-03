"use client";

import { useCallback, useEffect, useState } from "react";

interface Merchant { id: string; slug: string; name: string }
interface SellerOrder { sellerOrderId: string; orderId: string; orderStatus: string; status: string; subtotalMinor: string; currency: string; itemCount: number; petName: string | null; customerName: string | null; customerPhone: string | null; paymentMethod: string | null; paymentStatus: string; channel: string; needsAcceptance: boolean; createdAt: string }
interface CatalogItem { variantId: string; productName: string; variantName: string; sku: string; imageUrl: string | null; categoryId: string | null; categoryName: string | null; description: string | null; kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null; priceMinor: string | null; currency: string | null; available: number; status: string }
interface Category { id: string; slug: string; name: string; imageUrl: string | null; position: number }
interface AdoptionItem { id: string; name: string; species: string; age: string | null; description: string | null; imageUrl: string | null; contactWhatsapp: string | null; status: string; createdAt: string }
interface ReportSummary { paidOrders: number; gmvMinor: string; deliveryRevenueMinor: string; commissionMinor: string; merchantPayoutMinor: string; refundsMinor: string; avgTicketMinor: string }
interface ReportSeries { day: string; orders: number; gmvMinor: string }
interface ReportTop { productId: string; productName: string; unitsSold: number; revenueMinor: string }
interface ReportAlert { variantId: string; productName: string; variantName: string; available: number; reserved: number }
interface ReportData { summary: ReportSummary; series: ReportSeries[]; top: ReportTop[]; alerts: ReportAlert[] }
interface Theme {
  "branding.displayName": string;
  "branding.primaryColor": string;
  "branding.secondaryColor": string;
  "branding.logoUrl": string;
  "branding.bannerText": string;
  "branding.bannerImageUrl": string;
  "branding.layout": string;
  "branding.font": string;
  "branding.buttonShape": string;
  "contact.whatsapp": string;
  "contact.whatsappMessage": string;
  "storefront.promoText": string;
  "storefront.heroTitle": string;
  "storefront.heroHighlight": string;
  "storefront.heroSubtitle": string;
  "storefront.footerBlurb": string;
}
const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  rounded: "'Nunito', 'Quicksand', 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', Menlo, Consolas, monospace",
};
const BUTTON_RADIUS: Record<string, string> = { rounded: "10px", pill: "999px", square: "4px" };

const NEXT: Record<string, string[]> = {
  pending: ["preparing", "rejected"], preparing: ["ready"], ready: ["in_transit"],
  in_transit: ["delivered", "delivery_failed"], delivery_failed: ["in_transit"], delivered: [], rejected: [], cancelled: [],
};
const LABEL: Record<string, string> = { preparing: "Preparar", ready: "Listo", in_transit: "En camino", delivered: "Entregado", delivery_failed: "Falló", rejected: "Rechazar" };
const COLOR: Record<string, string> = { pending: "#b26a00", preparing: "#1a73e8", ready: "#8e24aa", in_transit: "#00796b", delivered: "#2e7d32", delivery_failed: "#c62828", rejected: "#c62828", cancelled: "#777" };
const CHANNEL_LABEL: Record<string, string> = { web: "🛒 Web", whatsapp: "💬 WhatsApp", telefono: "📞 Teléfono", mostrador: "🏪 Mostrador" };
const METHOD_LABEL: Record<string, string> = { online: "Online", efectivo: "Efectivo", pos: "Tarjeta (POS)", transferencia: "Transferencia" };

const money = (minor: string | number, c = "ARS") => (Number(minor) / 100).toLocaleString("es-AR", { style: "currency", currency: c });
const btn: React.CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 9, padding: "8px 14px", fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { ...btn, background: "#eef0f3", color: "#334" };
const input: React.CSSProperties = { padding: "8px 10px", borderRadius: 9, border: "1px solid #d4d6dc", background: "white" };
const card: React.CSSProperties = { background: "white", border: "1px solid #ececef", borderRadius: 12, padding: 14, boxShadow: "0 1px 3px rgba(0,0,0,.04)" };
const PANEL_CSS = `
.mbtn{transition:filter .15s ease, transform .05s ease;}
.mbtn:hover{filter:brightness(1.05);}
.mbtn:active{transform:scale(.98);}
`;

export default function MerchantPanel() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [tab, setTab] = useState<"catalogo" | "pedidos" | "reportes" | "diseno" | "adopciones">("catalogo");
  const [error, setError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    setTenant(new URLSearchParams(window.location.search).get("tenant"));
    try { setToken(localStorage.getItem("merchantToken") ?? ""); } catch { /* */ }
  }, []);

  const auth = { authorization: `Bearer ${token}` };
  const q = (p = "") => `?tenant=${encodeURIComponent(tenant ?? "")}${p}`;

  const loadMerchants = useCallback(async () => {
    if (!tenant || !token) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/merchants${q()}`, { headers: auth });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setMerchants(data.merchants);
      setMerchantId((m) => m || data.merchants[0]?.id || "");
    } catch (e) { setError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);

  useEffect(() => { if (token && tenant) void loadMerchants(); }, [token, tenant, loadMerchants]);

  async function newMerchant() {
    const name = prompt("Nombre del comercio:");
    if (!name) return;
    const res = await fetch(`/api/admin/merchants${q()}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error); return; }
    await loadMerchants();
    setMerchantId(data.merchantId);
  }

  function saveToken() { try { localStorage.setItem("merchantToken", tokenInput); } catch { /* */ } setToken(tokenInput); }
  function logout() { try { localStorage.removeItem("merchantToken"); } catch { /* */ } setToken(""); }

  /** Corre las migraciones pendientes y siembra categorías + catálogo demo del tenant
   *  actual (idempotente: no duplica; asigna categoría a productos demo sin ella). Útil tras
   *  un deploy con cambios de esquema. Gated por el mismo token del panel. */
  async function runMigrate() {
    setError(null);
    setMigrating(true);
    try {
      const seed = tenant ? `?seed=${encodeURIComponent(tenant)}` : "";
      const res = await fetch(`/api/admin/migrate${seed}`, { method: "POST", headers: auth });
      const data = await res.json();
      if (!res.ok) { setError(`migración: ${data.error ?? "error"}`); return; }
      await loadMerchants();
      const cats = data.seed?.categories ? `, ${data.seed.categories} categorías` : "";
      setError(`✓ Base actualizada (${(data.applied ?? []).length} migraciones${cats}). Recargá la tienda.`);
    } catch (e) { setError(String(e)); } finally { setMigrating(false); }
  }

  if (!token) {
    return (
      <div style={{ background: "#f6f7f9", minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
        <style>{PANEL_CSS}</style>
        <div style={{ ...card, maxWidth: 420, width: "100%", padding: 24 }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>🐾</div>
          <h1 style={{ fontSize: 21, margin: "0 0 4px" }}>Panel del comercio</h1>
          <p style={{ color: "#6b7280", fontSize: 14, marginTop: 0 }}>Ingresá el token de acceso (por ahora el <code>ADMIN_API_TOKEN</code>; el login con RBAC + MFA es el paso siguiente).</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveToken()} placeholder="token" type="password" style={{ ...input, flex: 1 }} />
            <button onClick={saveToken} className="mbtn" style={btn}>Entrar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#f6f7f9", minHeight: "100vh" }}>
      <style>{PANEL_CSS}</style>
      <main style={{ maxWidth: 920, margin: "0 auto", padding: "16px 16px 40px" }}>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 22 }}>🐾</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 11, color: "#9aa0aa", textTransform: "uppercase", letterSpacing: ".04em" }}>Comercio</span>
            <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ ...input, fontWeight: 600 }}>
              {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <button onClick={newMerchant} className="mbtn" style={btnGhost}>+ Nuevo comercio</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={runMigrate} disabled={migrating} className="mbtn" style={btnGhost} title="Aplica migraciones pendientes tras un deploy con cambios de esquema">
            {migrating ? "Migrando…" : "Migrar base"}
          </button>
          <button onClick={logout} className="mbtn" style={btnGhost}>Salir</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#eef0f3", padding: 4, borderRadius: 12, width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
        {(["catalogo", "pedidos", "reportes", "diseno", "adopciones"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="mbtn" style={{ border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, padding: "8px 16px", borderRadius: 9, background: tab === t ? "white" : "transparent", color: tab === t ? "#2563eb" : "#5b6270", boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
            {t === "catalogo" ? "Catálogo" : t === "pedidos" ? "Pedidos" : t === "reportes" ? "Reportes" : t === "diseno" ? "Diseño" : "Adopciones"}
          </button>
        ))}
      </div>

      {error && (
        error.startsWith("✓")
          ? <p style={{ color: "#2e7d32", fontWeight: 600 }}>{error}</p>
          : <p style={{ color: "#c00" }}>Error: {error}</p>
      )}

      {tab === "catalogo" ? <CatalogTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : tab === "pedidos" ? <OrdersTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : tab === "reportes" ? <ReportsTab tenant={tenant} token={token} onError={setError} />
        : tab === "diseno" ? <DesignTab tenant={tenant} token={token} onError={setError} />
        : <AdoptionsTab tenant={tenant} token={token} onError={setError} />}
      </main>
    </div>
  );
}

function CatalogTab({ tenant, token, merchantId, onError }: { tenant: string | null; token: string; merchantId: string; onError: (s: string | null) => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [f, setF] = useState({ productName: "", sku: "", price: "", stock: "", imageUrl: "", categoryId: "", description: "" });
  const [newCat, setNewCat] = useState({ name: "", imageUrl: "" });
  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant || !merchantId) return;
    const qs = `tenant=${encodeURIComponent(tenant)}&merchantId=${merchantId}`;
    const [cRes, catRes] = await Promise.all([
      fetch(`/api/merchant/catalog?${qs}`, { headers: auth }),
      fetch(`/api/merchant/categories?${qs}`, { headers: auth }),
    ]);
    const cData = await cRes.json();
    const catData = await catRes.json();
    if (!cRes.ok) { onError(cData.error); return; }
    setItems(cData.items);
    if (catRes.ok) setCats(catData.categories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, merchantId, token]);
  useEffect(() => { void load(); }, [load]);

  async function addProduct() {
    if (!f.productName || !f.sku || !f.price) { onError("Completá nombre, SKU y precio"); return; }
    onError(null);
    const res = await fetch(`/api/merchant/catalog?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ merchantId, productName: f.productName, sku: f.sku, priceMinor: Math.round(Number(f.price) * 100), stock: Number(f.stock || 0), imageUrl: f.imageUrl.trim(), categoryId: f.categoryId || undefined, description: f.description.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { onError(data.error); return; }
    setF({ productName: "", sku: "", price: "", stock: "", imageUrl: "", categoryId: f.categoryId, description: "" });
    await load();
  }

  async function addCategory() {
    if (!newCat.name.trim()) { onError("Poné un nombre de categoría"); return; }
    onError(null);
    const res = await fetch(`/api/merchant/categories?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ merchantId, name: newCat.name.trim(), imageUrl: newCat.imageUrl.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { onError(data.error); return; }
    setNewCat({ name: "", imageUrl: "" });
    await load();
  }

  async function renameCategory(id: string, current: string) {
    const name = prompt("Nuevo nombre de la categoría:", current);
    if (name === null || !name.trim() || name.trim() === current) return;
    onError(null);
    const res = await fetch(`/api/merchant/categories/${id}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) { const d = await res.json(); onError(d.error); return; }
    await load();
  }

  async function removeCategory(id: string, name: string) {
    if (!confirm(`¿Borrar la categoría "${name}"? Los productos quedan sin categoría.`)) return;
    onError(null);
    const res = await fetch(`/api/merchant/categories/${id}?tenant=${encodeURIComponent(tenant ?? "")}`, { method: "DELETE", headers: auth });
    if (!res.ok) { const d = await res.json(); onError(d.error); return; }
    await load();
  }

  async function save(variantId: string, priceMinor: number | null, stock: number, imageUrl: string, categoryId: string, description: string, food: { kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null }) {
    await fetch(`/api/merchant/catalog/${variantId}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...(priceMinor !== null ? { priceMinor } : {}), stock, imageUrl, categoryId, description, ...food }),
    });
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Categorías</h3>
        {cats.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {cats.map((c) => (
              <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eef0f3", borderRadius: 999, padding: "4px 6px 4px 12px", fontSize: 13, fontWeight: 600, color: "#445" }}>
                {c.name}
                <button onClick={() => renameCategory(c.id, c.name)} title="Renombrar" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✏️</button>
                <button onClick={() => removeCategory(c.id, c.name)} title="Borrar" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: "0 2px", color: "#c62828" }}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Nueva categoría (ej: Alimentos para Perros)" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} style={{ ...input, flex: 2, minWidth: 200 }} />
          <input placeholder="Foto de categoría (URL, opcional)" value={newCat.imageUrl} onChange={(e) => setNewCat({ ...newCat, imageUrl: e.target.value })} style={{ ...input, flex: 1, minWidth: 180 }} />
          <button onClick={addCategory} className="mbtn" style={btnGhost}>+ Crear categoría</button>
        </div>
      </div>

      <div style={{ ...card }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Cargar producto</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Nombre del producto" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} style={{ ...input, flex: 2, minWidth: 180 }} />
          <input placeholder="SKU" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} style={{ ...input, width: 110 }} />
          <input placeholder="Precio $" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} style={{ ...input, width: 110 }} />
          <input placeholder="Stock" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} style={{ ...input, width: 90 }} />
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ ...input, minWidth: 150 }}>
            <option value="">Sin categoría</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="Foto (URL https://…)" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} style={{ ...input, flex: 1, minWidth: 200 }} />
          <button onClick={addProduct} className="mbtn" style={btn}>Agregar</button>
        </div>
        <textarea placeholder="Descripción (opcional) — se muestra en la ficha del producto" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} style={{ ...input, width: "100%", boxSizing: "border-box", marginTop: 8, resize: "vertical", fontFamily: "inherit" }} />
      </div>

      {items.length === 0 ? <p style={{ color: "#888" }}>Este comercio no tiene productos. Cargá el primero arriba.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {items.map((it) => <CatalogRow key={it.variantId} it={it} cats={cats} onSave={save} />)}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({ it, cats, onSave }: { it: CatalogItem; cats: Category[]; onSave: (variantId: string, priceMinor: number | null, stock: number, imageUrl: string, categoryId: string, description: string, food: { kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null }) => void }) {
  const [price, setPrice] = useState(it.priceMinor ? String(Number(it.priceMinor) / 100) : "");
  const [stock, setStock] = useState(String(it.available));
  const [imageUrl, setImageUrl] = useState(it.imageUrl ?? "");
  const [categoryId, setCategoryId] = useState(it.categoryId ?? "");
  const [description, setDescription] = useState(it.description ?? "");
  const [kcal, setKcal] = useState(it.kcalPerKg != null ? String(it.kcalPerKg) : "");
  const [protein, setProtein] = useState(it.proteinPct != null ? String(it.proteinPct) : "");
  const [netKg, setNetKg] = useState(it.netWeightKg != null ? String(it.netWeightKg) : "");
  const [openDesc, setOpenDesc] = useState(false);
  const numN = (s: string): number | null => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; };
  const doSave = () => onSave(it.variantId, price ? Math.round(Number(price) * 100) : null, Number(stock), imageUrl.trim(), categoryId, description.trim(), { kcalPerKg: numN(kcal), proteinPct: numN(protein), netWeightKg: numN(netKg) });
  return (
    <li style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {it.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={it.imageUrl} alt={it.productName} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }} />
            : <span style={{ width: 40, height: 40, borderRadius: 6, background: "#f2f2f2", display: "grid", placeItems: "center", fontSize: 16 }}>🐾</span>}
          <span><strong>{it.productName}</strong> <span style={{ color: "#999", fontSize: 13 }}>{it.variantName} · {it.sku}</span></span>
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#777" }}>$ <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...input, width: 90 }} /></label>
          <label style={{ fontSize: 12, color: "#777" }}>Stock <input value={stock} onChange={(e) => setStock(e.target.value)} style={{ ...input, width: 70 }} /></label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...input, width: 150 }}>
            <option value="">Sin categoría</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="Foto (URL)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ ...input, width: 160 }} />
          <button onClick={() => setOpenDesc((v) => !v)} className="mbtn" style={btnGhost} title="Descripción y datos de alimento">{openDesc ? "▲ Más" : "▼ Más"}</button>
          <button onClick={doSave} className="mbtn" style={btn}>Guardar</button>
        </span>
      </div>
      {openDesc && (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea placeholder="Descripción del producto" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#777" }}>🍖 Alimento:</span>
            <label style={{ fontSize: 12, color: "#777" }}>kcal/kg <input value={kcal} onChange={(e) => setKcal(e.target.value.replace(/[^0-9]/g, ""))} placeholder="3600" style={{ ...input, width: 90 }} /></label>
            <label style={{ fontSize: 12, color: "#777" }}>Proteína % <input value={protein} onChange={(e) => setProtein(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="26" style={{ ...input, width: 70 }} /></label>
            <label style={{ fontSize: 12, color: "#777" }}>kg del paquete <input value={netKg} onChange={(e) => setNetKg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="15" style={{ ...input, width: 70 }} /></label>
          </div>
        </div>
      )}
    </li>
  );
}

function OrdersTab({ tenant, token, merchantId, onError }: { tenant: string | null; token: string; merchantId: string; onError: (s: string | null) => void }) {
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const res = await fetch(`/api/merchant/orders?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { onError(data.error); return; }
    setOrders(data.orders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function transition(id: string, to: string) {
    const res = await fetch(`/api/merchant/orders/${id}/transition?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ to }),
    });
    if (!res.ok) { const d = await res.json(); onError(d.error); }
    await load();
  }

  async function decide(orderId: string, decision: "aceptar" | "rechazar") {
    const res = await fetch(`/api/merchant/orders/${orderId}/decision?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ decision }),
    });
    if (!res.ok) { const d = await res.json(); onError(d.error); }
    await load();
  }

  // Título humano del pedido: "Pedido de Bruno" cuando sabemos la mascota.
  const titleOf = (o: SellerOrder) => (o.petName ? `Pedido de ${o.petName}` : `Pedido #${o.orderId.slice(0, 8)}`);
  const pending = orders.filter((o) => o.needsAcceptance);
  const active = orders.filter((o) => !o.needsAcceptance);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setShowNew(true)} className="mbtn" style={btn}>＋ Nuevo pedido</button>
        <button onClick={load} className="mbtn" style={btnGhost}>{loading ? "…" : "Actualizar"}</button>
      </div>

      {showNew && (
        <ManualOrderForm tenant={tenant} token={token} merchantId={merchantId} onError={onError}
          onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void load(); }} />
      )}

      {/* Pedidos por aceptar (pago al recibir) — arriba, es lo que requiere acción. */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 14, color: "#b26a00", margin: "0 0 8px" }}>Por aceptar ({pending.length})</h3>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {pending.map((o) => (
              <li key={o.sellerOrderId} style={{ ...card, borderColor: "#f0c98a", background: "#fffdf7" }}>
                <OrderHead o={o} title={titleOf(o)} />
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button onClick={() => decide(o.orderId, "aceptar")} className="mbtn" style={{ ...btn, background: "#2e7d32" }}>Aceptar</button>
                  <button onClick={() => decide(o.orderId, "rechazar")} className="mbtn" style={{ ...btn, background: "#c62828" }}>Rechazar</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pedidos aceptados / en curso: máquina de cumplimiento existente. */}
      <h3 style={{ fontSize: 14, color: "#5b6270", margin: "0 0 8px" }}>En curso ({active.length})</h3>
      {active.length === 0 ? <p style={{ color: "#888" }}>No hay pedidos en curso.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {active.map((o) => (
            <li key={o.sellerOrderId} style={card}>
              <OrderHead o={o} title={titleOf(o)} />
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(NEXT[o.status] ?? []).length === 0 ? <span style={{ color: "#aaa", fontSize: 13 }}>— sin acciones —</span>
                  : (NEXT[o.status] ?? []).map((to) => (
                    <button key={to} onClick={() => transition(o.sellerOrderId, to)} className="mbtn" style={to === "rejected" || to === "delivery_failed" ? { ...btn, background: "#c62828" } : btn}>{LABEL[to] ?? to}</button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Encabezado de un pedido en el panel: mascota (protagonista), cliente, pago y canal. */
function OrderHead({ o, title }: { o: SellerOrder; title: string }) {
  const paid = o.paymentStatus === "pagado";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        <div style={{ color: "#666", fontSize: 12.5, marginTop: 3 }}>
          {o.customerName ? <span>{o.customerName} · </span> : null}
          {o.customerPhone ? <span>📱 {o.customerPhone} · </span> : null}
          {o.itemCount} ítem(s) · {money(o.subtotalMinor, o.currency)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <span style={{ background: "#eef0f3", color: "#334", borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
          <span style={{ background: paid ? "#e6f4ea" : "#fdecea", color: paid ? "#2e7d32" : "#b26a00", borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 600 }}>
            {paid ? "Pagado" : "Pago pendiente"}{o.paymentMethod ? ` · ${METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}` : ""}
          </span>
        </div>
      </div>
      <span style={{ background: COLOR[o.status] ?? "#777", color: "white", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{o.status}</span>
    </div>
  );
}

type PetLite = { id: string; name: string; species: string };
type ManualLine = { variantId: string; name: string; priceMinor: number; qty: number };

/**
 * Pedido manual (WhatsApp / teléfono / mostrador). Mismo modelo Order del ecommerce: aparece
 * junto a los pedidos web, en el historial del cliente/mascota y en los reportes. Flujo:
 * teléfono → (reconoce cliente + mascotas) → productos → entrega → pago → canal → confirmar.
 */
function ManualOrderForm({ tenant, token, merchantId, onClose, onCreated, onError }: {
  tenant: string | null; token: string; merchantId: string; onClose: () => void; onCreated: () => void; onError: (s: string | null) => void;
}) {
  const auth = { authorization: `Bearer ${token}` };
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [greetName, setGreetName] = useState<string | null>(null);
  const [pets, setPets] = useState<PetLite[]>([]);
  const [petSel, setPetSel] = useState("");
  const [newPet, setNewPet] = useState({ name: "", species: "perro", weight: "" });
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<ManualLine[]>([]);
  const [channel, setChannel] = useState("whatsapp");
  const [method, setMethod] = useState("efectivo");
  const [payStatus, setPayStatus] = useState("pendiente");
  const [addr, setAddr] = useState({ street: "", zone: "", notes: "" });
  const [busy, setBusy] = useState(false);

  // Catálogo del comercio para elegir productos (mismos precios que la tienda).
  useEffect(() => {
    if (!tenant || !merchantId) return;
    fetch(`/api/merchant/catalog?tenant=${encodeURIComponent(tenant)}&merchantId=${encodeURIComponent(merchantId)}`, { headers: auth })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items) setCatalog(d.items as CatalogItem[]); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, merchantId, token]);

  // Reconocer al cliente por teléfono (debounce): trae nombre + mascotas.
  useEffect(() => {
    const digits = phone.replace(/\D+/g, "");
    if (!tenant || digits.length < 6) { setGreetName(null); setPets([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/customer/lookup?tenant=${encodeURIComponent(tenant)}&phone=${encodeURIComponent(digits)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          setGreetName(d.found ? (d.name ?? null) : null);
          if (d.found && d.name && !customerName.trim()) setCustomerName(d.name);
          setPets(Array.isArray(d.pets) ? (d.pets as PetLite[]) : []);
        })
        .catch(() => {});
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, tenant]);

  const results = q.trim()
    ? catalog.filter((c) => c.priceMinor && `${c.productName} ${c.variantName} ${c.sku}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];
  const addLine = (c: CatalogItem) => {
    setLines((ls) => {
      const ex = ls.find((l) => l.variantId === c.variantId);
      if (ex) return ls.map((l) => (l.variantId === c.variantId ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { variantId: c.variantId, name: `${c.productName} · ${c.variantName}`, priceMinor: Number(c.priceMinor), qty: 1 }];
    });
    setQ("");
  };
  const setQty = (variantId: string, qty: number) =>
    setLines((ls) => (qty <= 0 ? ls.filter((l) => l.variantId !== variantId) : ls.map((l) => (l.variantId === variantId ? { ...l, qty } : l))));
  const total = lines.reduce((a, l) => a + l.priceMinor * l.qty, 0);

  async function submit() {
    if (!phone.trim()) { onError("Ingresá el teléfono del cliente."); return; }
    if (lines.length === 0) { onError("Agregá al menos un producto."); return; }
    setBusy(true); onError(null);
    const petFields = petSel
      ? { petId: petSel }
      : newPet.name.trim()
        ? { petName: newPet.name.trim(), petSpecies: newPet.species, ...(Number(newPet.weight) > 0 ? { petWeightKg: Number(newPet.weight) } : {}) }
        : {};
    const res = await fetch(`/api/merchant/orders/manual?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        phone: phone.trim(),
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...petFields,
        items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
        channel, paymentMethod: method, paymentStatus: payStatus,
        ...(addr.street.trim() ? { address: addr } : {}),
      }),
    });
    setBusy(false);
    const d = await res.json();
    if (!res.ok) { onError(d.error ?? "error"); return; }
    onCreated();
  }

  const hasPets = pets.length > 0;
  const addingNew = !petSel;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(20,22,28,.45)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 14, width: 620, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Nuevo pedido</h2>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", color: "#888" }}>×</button>
        </div>
        <p style={{ color: "#6b7280", fontSize: 13, marginTop: 0 }}>Para lo que llega por WhatsApp, teléfono o mostrador. Queda igual que un pedido web.</p>

        {/* 1. Cliente por teléfono */}
        <label style={lbl}>1 · Cliente (teléfono)</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input style={input} placeholder="Teléfono / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input style={input} placeholder="Nombre del cliente" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        {greetName && <div style={{ fontSize: 12.5, color: "#2e7d32", fontWeight: 600, marginTop: 6 }}>Cliente conocido: {greetName} 🐾</div>}

        {/* 2. Mascota */}
        <label style={lbl}>2 · ¿Para quién es el pedido?</label>
        {hasPets && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: addingNew ? 8 : 0 }}>
            {pets.map((p) => {
              const on = petSel === p.id;
              return (
                <button key={p.id} type="button" onClick={() => setPetSel(on ? "" : p.id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, cursor: "pointer",
                    border: `1.5px solid ${on ? "#2e7d32" : "#d4d6dc"}`, background: on ? "#e6f4ea" : "white", fontSize: 13, fontWeight: 600 }}>
                  {({ perro: "🐶", gato: "🐱" } as Record<string, string>)[p.species] ?? "🐾"} {p.name}
                </button>
              );
            })}
            <button type="button" onClick={() => setPetSel("")} style={{ padding: "7px 12px", borderRadius: 999, cursor: "pointer", border: `1.5px dashed ${addingNew ? "#2e7d32" : "#d4d6dc"}`, background: "white", fontSize: 13, fontWeight: 600, color: "#5b6270" }}>＋ Mascota</button>
          </div>
        )}
        {addingNew && (
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8 }}>
            <input style={input} placeholder="Nombre (ej: Bruno)" value={newPet.name} onChange={(e) => setNewPet({ ...newPet, name: e.target.value })} />
            <select style={input} value={newPet.species} onChange={(e) => setNewPet({ ...newPet, species: e.target.value })}>
              <option value="perro">🐶 Perro</option><option value="gato">🐱 Gato</option><option value="otro">🐾 Otro</option>
            </select>
            <input style={input} placeholder="Peso kg (opc.)" value={newPet.weight} onChange={(e) => setNewPet({ ...newPet, weight: e.target.value })} />
          </div>
        )}

        {/* 3. Productos */}
        <label style={lbl}>3 · Productos</label>
        <input style={{ ...input, width: "100%" }} placeholder="Buscar producto del catálogo…" value={q} onChange={(e) => setQ(e.target.value)} />
        {results.length > 0 && (
          <div style={{ border: "1px solid #ececef", borderRadius: 9, marginTop: 6 }}>
            {results.map((c) => (
              <div key={c.variantId} onClick={() => addLine(c)} className="mbtn" style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f4f4f6" }}>
                <span style={{ fontSize: 13 }}>{c.productName} · {c.variantName}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{money(c.priceMinor ?? 0, c.currency ?? "ARS")}</span>
              </div>
            ))}
          </div>
        )}
        {lines.length > 0 && (
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {lines.map((l) => (
              <div key={l.variantId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ flex: 1 }}>{l.name}</span>
                <button onClick={() => setQty(l.variantId, l.qty - 1)} style={qtyBtn}>−</button>
                <span style={{ width: 20, textAlign: "center", fontWeight: 600 }}>{l.qty}</span>
                <button onClick={() => setQty(l.variantId, l.qty + 1)} style={qtyBtn}>+</button>
                <span style={{ width: 90, textAlign: "right", fontWeight: 600 }}>{money(l.priceMinor * l.qty)}</span>
              </div>
            ))}
            <div style={{ textAlign: "right", fontWeight: 700, marginTop: 4 }}>Total: {money(total)}</div>
          </div>
        )}

        {/* 4. Entrega (opcional) */}
        <label style={lbl}>4 · Entrega (opcional — vacío = retira en mostrador)</label>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <input style={input} placeholder="Calle y número" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} />
          <input style={input} placeholder="Barrio / zona" value={addr.zone} onChange={(e) => setAddr({ ...addr, zone: e.target.value })} />
        </div>

        {/* 5 y 6. Pago + canal */}
        <label style={lbl}>5 · Pago y canal</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <select style={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="pos">Tarjeta (POS)</option>
          </select>
          <select style={input} value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
            <option value="pendiente">Pago pendiente</option><option value="pagado">Ya pagó</option>
          </select>
          <select style={input} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">💬 WhatsApp</option><option value="telefono">📞 Teléfono</option><option value="mostrador">🏪 Mostrador</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={submit} disabled={busy} className="mbtn" style={{ ...btn, background: "#2e7d32", flex: 1, padding: 12 }}>{busy ? "Creando…" : "Confirmar pedido"}</button>
          <button onClick={onClose} className="mbtn" style={{ ...btnGhost, padding: 12 }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "#374151", margin: "16px 0 7px", textTransform: "uppercase", letterSpacing: ".03em" };
const qtyBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, border: "1px solid #d4d6dc", background: "white", cursor: "pointer", fontSize: 15 };

function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ ...card, minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? "#111" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function ReportsTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/reports?tenant=${encodeURIComponent(tenant)}&days=14`, { headers: auth });
      const d = await res.json();
      setLoading(false);
      if (!res.ok) { onError(d.error); return; }
      setData(d);
    } catch (e) { setLoading(false); onError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <p style={{ color: "#888" }}>{loading ? "Cargando reportes…" : "Sin datos."}</p>;
  const s = data.summary;
  const maxGmv = Math.max(1, ...data.series.map((r) => Number(r.gmvMinor)));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <button onClick={load} className="mbtn" style={{ ...btnGhost, justifySelf: "start" }}>{loading ? "…" : "Actualizar"}</button>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Metric label="Pedidos pagados" value={String(s.paidOrders)} />
        <Metric label="GMV (ventas)" value={money(s.gmvMinor)} hint="valor de mercadería vendida" />
        <Metric label="Comisión plataforma" value={money(s.commissionMinor)} accent="#2563eb" hint="contribución" />
        <Metric label="A pagar a comercios" value={money(s.merchantPayoutMinor)} accent="#2e7d32" hint="payout" />
        <Metric label="Envíos cobrados" value={money(s.deliveryRevenueMinor)} />
        <Metric label="Ticket promedio" value={money(s.avgTicketMinor)} />
        {Number(s.refundsMinor) > 0 && <Metric label="Devoluciones" value={money(s.refundsMinor)} accent="#c62828" />}
      </div>

      <div style={card}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Ventas últimos 14 días</h3>
        {data.series.length === 0 ? <p style={{ color: "#aaa", margin: 0 }}>Todavía no hay ventas.</p> : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {data.series.map((r) => (
              <div key={r.day} title={`${r.day}: ${money(r.gmvMinor)} · ${r.orders} pedido(s)`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", background: "#2563eb", borderRadius: "4px 4px 0 0", height: `${Math.max(4, (Number(r.gmvMinor) / maxGmv) * 100)}%` }} />
                <span style={{ fontSize: 9, color: "#aaa" }}>{r.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={card}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Top productos</h3>
          {data.top.length === 0 ? <p style={{ color: "#aaa", margin: 0 }}>Sin ventas.</p> : (
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {data.top.map((t) => (
                <li key={t.productId} style={{ fontSize: 14 }}>
                  <strong>{t.productName}</strong> <span style={{ color: "#999" }}>· {t.unitsSold} u · {money(t.revenueMinor)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div style={card}>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Alertas de stock <span style={{ fontSize: 12, color: "#aaa" }}>(≤ 5)</span></h3>
          {data.alerts.length === 0 ? <p style={{ color: "#2e7d32", margin: 0 }}>Sin alertas: stock OK.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {data.alerts.map((a) => (
                <li key={a.variantId} style={{ fontSize: 14, display: "flex", justifyContent: "space-between" }}>
                  <span>{a.productName} <span style={{ color: "#999", fontSize: 12 }}>{a.variantName}</span></span>
                  <span style={{ color: a.available === 0 ? "#c62828" : "#b26a00", fontWeight: 600 }}>{a.available} disp.</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_THEME: Theme = {
  "branding.displayName": "Pet Shop",
  "branding.primaryColor": "#2563eb",
  "branding.secondaryColor": "#1e293b",
  "branding.logoUrl": "",
  "branding.bannerText": "",
  "branding.bannerImageUrl": "",
  "branding.layout": "grid",
  "branding.font": "system",
  "branding.buttonShape": "rounded",
  "contact.whatsapp": "",
  "contact.whatsappMessage": "¡Hola! Quiero hacer un pedido.",
  "storefront.promoText": "",
  "storefront.heroTitle": "",
  "storefront.heroHighlight": "",
  "storefront.heroSubtitle": "",
  "storefront.footerBlurb": "",
};

type Pair = { t: string; s: string };
const pairsToText = (v: unknown): string => (Array.isArray(v) ? v.map((p) => `${(p as Pair).t ?? ""} | ${(p as Pair).s ?? ""}`).join("\n") : "");
const textToPairs = (text: string): Pair[] =>
  text.split("\n").map((line) => { const [t, ...rest] = line.split("|"); return { t: (t ?? "").trim(), s: rest.join("|").trim() }; }).filter((p) => p.t);

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "#555", marginBottom: 4 }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: 11, color: "#aaa", marginTop: 2 }}>{hint}</span>}
    </label>
  );
}

function DesignTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [perksText, setPerksText] = useState("");
  const [benefitsText, setBenefitsText] = useState("");
  const [adoptionsTitle, setAdoptionsTitle] = useState("Adopciones");
  const [flags, setFlags] = useState({ "features.adoptions": true, "features.foodCalculator": true, "features.foodComparator": true });
  const toggle = (k: keyof typeof flags) => { setFlags((s) => ({ ...s, [k]: !s[k] })); setSaved(false); };
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const auth = { authorization: `Bearer ${token}` };
  const set = (k: keyof Theme, v: string) => { setTheme((t) => ({ ...t, [k]: v })); setSaved(false); };

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/branding?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
      const d = await res.json();
      setLoading(false);
      if (!res.ok) { onError(d.error); return; }
      setTheme({ ...DEFAULT_THEME, ...d.theme });
      setPerksText(pairsToText(d.theme?.["storefront.perks"]));
      setBenefitsText(pairsToText(d.theme?.["storefront.benefits"]));
      if (typeof d.theme?.["storefront.adoptionsTitle"] === "string") setAdoptionsTitle(d.theme["storefront.adoptionsTitle"]);
      setFlags({
        "features.adoptions": d.theme?.["features.adoptions"] !== false,
        "features.foodCalculator": d.theme?.["features.foodCalculator"] !== false,
        "features.foodComparator": d.theme?.["features.foodComparator"] !== false,
      });
    } catch (e) { setLoading(false); onError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    onError(null);
    setSaving(true);
    try {
      const body = { ...theme, "storefront.perks": textToPairs(perksText), "storefront.benefits": textToPairs(benefitsText), "storefront.adoptionsTitle": adoptionsTitle, ...flags };
      const res = await fetch(`/api/merchant/branding?tenant=${encodeURIComponent(tenant ?? "")}`, {
        method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      setSaving(false);
      if (!res.ok) { onError(`${d.error}${d.key ? ` (${d.key})` : ""}`); return; }
      setSaved(true);
    } catch (e) { setSaving(false); onError(String(e)); }
  }

  const primary = theme["branding.primaryColor"] || "#2563eb";
  const secondary = theme["branding.secondaryColor"] || "#1e293b";
  const banner = theme["branding.bannerImageUrl"];

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <div style={card}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Diseño de la tienda</h3>
        {loading && <p style={{ color: "#888" }}>Cargando…</p>}
        <Field label="Nombre visible">
          <input value={theme["branding.displayName"]} onChange={(e) => set("branding.displayName", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Color primario">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(primary) ? primary : "#2563eb"} onChange={(e) => set("branding.primaryColor", e.target.value)} style={{ width: 56, height: 34, border: "1px solid #ccc", borderRadius: 8, background: "white" }} />
          </Field>
          <Field label="Color secundario">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(secondary) ? secondary : "#1e293b"} onChange={(e) => set("branding.secondaryColor", e.target.value)} style={{ width: 56, height: 34, border: "1px solid #ccc", borderRadius: 8, background: "white" }} />
          </Field>
        </div>
        <Field label="Logo (URL)" hint="http/https. Vacío = sin logo.">
          <input value={theme["branding.logoUrl"]} onChange={(e) => set("branding.logoUrl", e.target.value)} placeholder="https://…/logo.png" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Texto del banner" hint="Lema que se muestra bajo el nombre.">
          <input value={theme["branding.bannerText"]} onChange={(e) => set("branding.bannerText", e.target.value)} placeholder="Todo para tu mascota, en el día" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Imagen del banner (URL)" hint="http/https. Vacío = fondo de color.">
          <input value={theme["branding.bannerImageUrl"]} onChange={(e) => set("branding.bannerImageUrl", e.target.value)} placeholder="https://…/banner.jpg" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Disposición del catálogo">
          <select value={theme["branding.layout"]} onChange={(e) => set("branding.layout", e.target.value)} style={{ ...input, width: "100%" }}>
            <option value="grid">Grilla</option>
            <option value="list">Lista</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Tipografía">
            <select value={theme["branding.font"]} onChange={(e) => set("branding.font", e.target.value)} style={{ ...input, width: "100%" }}>
              <option value="system">Sistema</option>
              <option value="serif">Serif (elegante)</option>
              <option value="rounded">Redondeada</option>
              <option value="mono">Monoespaciada</option>
            </select>
          </Field>
          <Field label="Forma de botones">
            <select value={theme["branding.buttonShape"]} onChange={(e) => set("branding.buttonShape", e.target.value)} style={{ ...input, width: "100%" }}>
              <option value="rounded">Redondeados</option>
              <option value="pill">Píldora</option>
              <option value="square">Rectos</option>
            </select>
          </Field>
        </div>
        <div style={{ borderTop: "1px solid #eee", margin: "6px 0 12px" }} />
        <Field label="WhatsApp (solo números, con código de país)" hint="Ej: 5493444123456. Vacío = sin botón de WhatsApp.">
          <input value={theme["contact.whatsapp"]} onChange={(e) => set("contact.whatsapp", e.target.value.replace(/[^0-9]/g, ""))} placeholder="5493444123456" inputMode="numeric" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Mensaje prellenado de WhatsApp">
          <input value={theme["contact.whatsappMessage"]} onChange={(e) => set("contact.whatsappMessage", e.target.value)} placeholder="¡Hola! Quiero hacer un pedido." style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>

        <div style={{ borderTop: "1px solid #eee", margin: "6px 0 12px" }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#556", marginBottom: 8 }}>Textos de la tienda</div>
        <Field label="Barra promocional (arriba de todo)">
          <input value={theme["storefront.promoText"]} onChange={(e) => set("storefront.promoText", e.target.value)} placeholder="Envíos gratis en compras superiores a $25.000" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Título del hero"><input value={theme["storefront.heroTitle"]} onChange={(e) => set("storefront.heroTitle", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></Field>
          <Field label="Destacado (en color)"><input value={theme["storefront.heroHighlight"]} onChange={(e) => set("storefront.heroHighlight", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></Field>
        </div>
        <Field label="Subtítulo del hero">
          <input value={theme["storefront.heroSubtitle"]} onChange={(e) => set("storefront.heroSubtitle", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <Field label="Beneficios cortos del hero" hint="Uno por línea, formato: Título | Subtítulo">
          <textarea value={perksText} onChange={(e) => { setPerksText(e.target.value); setSaved(false); }} rows={3} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
        </Field>
        <Field label="Franja de beneficios" hint="Uno por línea, formato: Título | Subtítulo">
          <textarea value={benefitsText} onChange={(e) => { setBenefitsText(e.target.value); setSaved(false); }} rows={5} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }} />
        </Field>
        <Field label="Texto del footer">
          <input value={theme["storefront.footerBlurb"]} onChange={(e) => set("storefront.footerBlurb", e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>

        <div style={{ borderTop: "1px solid #eee", margin: "6px 0 12px" }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: "#556", marginBottom: 8 }}>Funciones de la tienda</div>
        {([["features.foodCalculator", "Calculadora de consumo + Mis mascotas"], ["features.foodComparator", "Comparador de alimentos (costo por día)"], ["features.adoptions", "Sección de Adopciones / callejeritos"]] as const).map(([k, label]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, padding: "4px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={flags[k]} onChange={() => toggle(k)} style={{ width: 16, height: 16 }} />
            {label}
          </label>
        ))}
        <Field label="Nombre de la sección de adopciones" hint="Ej: Adopciones, Callejeritos">
          <input value={adoptionsTitle} onChange={(e) => { setAdoptionsTitle(e.target.value); setSaved(false); }} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <button onClick={save} disabled={saving} className="mbtn" style={btn}>{saving ? "Guardando…" : "Guardar diseño"}</button>
          {saved && <span style={{ color: "#2e7d32", fontSize: 13 }}>✓ Guardado. Recargá la tienda para verlo.</span>}
        </div>
      </div>

      <div style={{ ...card, fontFamily: FONT_STACKS[theme["branding.font"]] ?? FONT_STACKS.system }}>
        {theme["branding.font"] === "rounded" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" />}
        {theme["branding.font"] === "mono" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" />}
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Vista previa</h3>
        <div
          style={{
            color: "white", padding: "20px 16px", borderRadius: 12,
            background: banner
              ? `linear-gradient(135deg, ${primary}dd, ${secondary}cc), url("${banner}") center/cover`
              : `linear-gradient(135deg, ${primary}, ${secondary})`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {theme["branding.logoUrl"] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme["branding.logoUrl"]} alt="logo" style={{ height: 40, width: 40, objectFit: "contain", borderRadius: 8, background: "rgba(255,255,255,.9)", padding: 4 }} />
            )}
            <strong style={{ fontSize: 20 }}>{theme["branding.displayName"] || "Pet Shop"}</strong>
          </div>
          <p style={{ margin: "6px 0 0", opacity: 0.9 }}>{theme["branding.bannerText"] || "¿Qué necesitás para tu mascota?"}</p>
        </div>
        <div style={{ marginTop: 12, display: "grid", gap: 8, gridTemplateColumns: theme["branding.layout"] === "list" ? "1fr" : "1fr 1fr" }}>
          {["Alimento premium", "Juguete"].map((n) => (
            <div key={n} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, display: "flex", flexDirection: theme["branding.layout"] === "list" ? "row" : "column", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 14 }}>{n}</span>
              <button style={{ ...btn, background: primary, borderRadius: BUTTON_RADIUS[theme["branding.buttonShape"]] ?? "10px", alignSelf: theme["branding.layout"] === "list" ? "center" : "stretch" }}>Agregar</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdoptionsTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [items, setItems] = useState<AdoptionItem[]>([]);
  const [f, setF] = useState({ name: "", species: "perro", age: "", description: "", imageUrl: "", contactWhatsapp: "" });
  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant) return;
    const res = await fetch(`/api/merchant/adoptions?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    const d = await res.json();
    if (!res.ok) { onError(d.error); return; }
    setItems(d.adoptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function publish() {
    if (!f.name.trim()) { onError("Poné un nombre"); return; }
    onError(null);
    const res = await fetch(`/api/merchant/adoptions?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(f),
    });
    const d = await res.json();
    if (!res.ok) { onError(d.error); return; }
    setF({ name: "", species: f.species, age: "", description: "", imageUrl: "", contactWhatsapp: "" });
    await load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/merchant/adoptions/${id}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); onError(d.error); return; }
    await load();
  }
  async function remove(id: string, name: string) {
    if (!confirm(`¿Borrar la publicación de "${name}"?`)) return;
    const res = await fetch(`/api/merchant/adoptions/${id}?tenant=${encodeURIComponent(tenant ?? "")}`, { method: "DELETE", headers: auth });
    if (!res.ok) { const d = await res.json(); onError(d.error); return; }
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={card}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Publicar mascota en adopción</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Nombre (ej: Rocky)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ ...input, flex: 1, minWidth: 150 }} />
          <select value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} style={{ ...input, width: 110 }}>
            <option value="perro">Perro</option>
            <option value="gato">Gato</option>
            <option value="otro">Otro</option>
          </select>
          <input placeholder="Edad / detalle (ej: 2 años)" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} style={{ ...input, width: 160 }} />
          <input placeholder="WhatsApp de contacto (opcional)" value={f.contactWhatsapp} onChange={(e) => setF({ ...f, contactWhatsapp: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" style={{ ...input, width: 190 }} />
          <input placeholder="Foto (URL https://…)" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} style={{ ...input, flex: 1, minWidth: 200 }} />
        </div>
        <textarea placeholder="Descripción (temperamento, castrado, vacunas…)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} style={{ ...input, width: "100%", boxSizing: "border-box", marginTop: 8, resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ marginTop: 8 }}><button onClick={publish} className="mbtn" style={btn}>Publicar</button></div>
      </div>

      {items.length === 0 ? <p style={{ color: "#888" }}>No hay publicaciones. Cargá la primera arriba.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {items.map((a) => (
            <li key={a.id} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, opacity: a.status === "adopted" ? 0.6 : 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {a.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.imageUrl} alt={a.name} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid #eee" }} />
                  : <span style={{ width: 44, height: 44, borderRadius: 8, background: "#f2f2f2", display: "grid", placeItems: "center", fontSize: 18 }}>🐾</span>}
                <span>
                  <strong>{a.name}</strong> <span style={{ color: "#999", fontSize: 13 }}>{a.species}{a.age ? ` · ${a.age}` : ""}</span>
                  {a.status === "adopted" && <span style={{ marginLeft: 8, background: "#e6f4ea", color: "#2e7d32", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>Adoptado</span>}
                </span>
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {a.status === "available"
                  ? <button onClick={() => patch(a.id, { status: "adopted" })} className="mbtn" style={btnGhost}>Marcar adoptado</button>
                  : <button onClick={() => patch(a.id, { status: "available" })} className="mbtn" style={btnGhost}>Reactivar</button>}
                <button onClick={() => remove(a.id, a.name)} className="mbtn" style={{ ...btnGhost, color: "#c62828" }}>Borrar</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
