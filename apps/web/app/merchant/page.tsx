"use client";

import { useCallback, useEffect, useState } from "react";

interface Merchant { id: string; slug: string; name: string }
interface SellerOrder { sellerOrderId: string; orderId: string; status: string; subtotalMinor: string; currency: string; itemCount: number; createdAt: string }
interface CatalogItem { variantId: string; productName: string; variantName: string; sku: string; imageUrl: string | null; priceMinor: string | null; currency: string | null; available: number; status: string }
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

const money = (minor: string | number, c = "ARS") => (Number(minor) / 100).toLocaleString("es-AR", { style: "currency", currency: c });
const btn: React.CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { ...btn, background: "#eee", color: "#333" };
const input: React.CSSProperties = { padding: "7px 9px", borderRadius: 8, border: "1px solid #ccc" };
const card: React.CSSProperties = { background: "white", border: "1px solid #eee", borderRadius: 10, padding: 12 };

export default function MerchantPanel() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [tab, setTab] = useState<"catalogo" | "pedidos" | "reportes" | "diseno">("catalogo");
  const [error, setError] = useState<string | null>(null);

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

  if (!token) {
    return (
      <main style={{ maxWidth: 480, margin: "12vh auto", padding: 16 }}>
        <h1 style={{ fontSize: 20 }}>Panel del comercio</h1>
        <p style={{ color: "#666" }}>Ingresá el token de acceso (por ahora el <code>ADMIN_API_TOKEN</code>; el login con RBAC + MFA es el paso siguiente).</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="token" style={{ ...input, flex: 1 }} />
          <button onClick={saveToken} style={btn}>Entrar</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong>Comercio:</strong>
          <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={input}>
            {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button onClick={newMerchant} style={btnGhost}>+ Nuevo comercio</button>
        </div>
        <button onClick={logout} style={btnGhost}>Salir</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, borderBottom: "1px solid #eee" }}>
        {(["catalogo", "pedidos", "reportes", "diseno"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btnGhost, background: tab === t ? "#2563eb" : "#eee", color: tab === t ? "white" : "#333", borderRadius: "8px 8px 0 0" }}>
            {t === "catalogo" ? "Catálogo" : t === "pedidos" ? "Pedidos" : t === "reportes" ? "Reportes" : "Diseño"}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#c00" }}>Error: {error}</p>}

      {tab === "catalogo" ? <CatalogTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : tab === "pedidos" ? <OrdersTab tenant={tenant} token={token} onError={setError} />
        : tab === "reportes" ? <ReportsTab tenant={tenant} token={token} onError={setError} />
        : <DesignTab tenant={tenant} token={token} onError={setError} />}
    </main>
  );
}

function CatalogTab({ tenant, token, merchantId, onError }: { tenant: string | null; token: string; merchantId: string; onError: (s: string | null) => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [f, setF] = useState({ productName: "", sku: "", price: "", stock: "", imageUrl: "" });
  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant || !merchantId) return;
    const res = await fetch(`/api/merchant/catalog?tenant=${encodeURIComponent(tenant)}&merchantId=${merchantId}`, { headers: auth });
    const data = await res.json();
    if (!res.ok) { onError(data.error); return; }
    setItems(data.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, merchantId, token]);
  useEffect(() => { void load(); }, [load]);

  async function addProduct() {
    if (!f.productName || !f.sku || !f.price) { onError("Completá nombre, SKU y precio"); return; }
    onError(null);
    const res = await fetch(`/api/merchant/catalog?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ merchantId, productName: f.productName, sku: f.sku, priceMinor: Math.round(Number(f.price) * 100), stock: Number(f.stock || 0), imageUrl: f.imageUrl.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { onError(data.error); return; }
    setF({ productName: "", sku: "", price: "", stock: "", imageUrl: "" });
    await load();
  }

  async function save(variantId: string, priceMinor: number | null, stock: number, imageUrl?: string) {
    await fetch(`/api/merchant/catalog/${variantId}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...(priceMinor !== null ? { priceMinor } : {}), stock, ...(imageUrl !== undefined ? { imageUrl } : {}) }),
    });
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...card }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Cargar producto</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Nombre del producto" value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} style={{ ...input, flex: 2, minWidth: 180 }} />
          <input placeholder="SKU" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} style={{ ...input, width: 110 }} />
          <input placeholder="Precio $" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} style={{ ...input, width: 110 }} />
          <input placeholder="Stock" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} style={{ ...input, width: 90 }} />
          <input placeholder="Foto (URL https://…)" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} style={{ ...input, flex: 1, minWidth: 200 }} />
          <button onClick={addProduct} style={btn}>Agregar</button>
        </div>
      </div>

      {items.length === 0 ? <p style={{ color: "#888" }}>Este comercio no tiene productos. Cargá el primero arriba.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {items.map((it) => <CatalogRow key={it.variantId} it={it} onSave={save} />)}
        </ul>
      )}
    </div>
  );
}

function CatalogRow({ it, onSave }: { it: CatalogItem; onSave: (variantId: string, priceMinor: number | null, stock: number, imageUrl?: string) => void }) {
  const [price, setPrice] = useState(it.priceMinor ? String(Number(it.priceMinor) / 100) : "");
  const [stock, setStock] = useState(String(it.available));
  const [imageUrl, setImageUrl] = useState(it.imageUrl ?? "");
  return (
    <li style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
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
        <input placeholder="Foto (URL)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={{ ...input, width: 180 }} />
        <button onClick={() => onSave(it.variantId, price ? Math.round(Number(price) * 100) : null, Number(stock), imageUrl.trim())} style={btn}>Guardar</button>
      </span>
    </li>
  );
}

function OrdersTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(false);
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

  return (
    <div>
      <button onClick={load} style={{ ...btnGhost, marginBottom: 10 }}>{loading ? "…" : "Actualizar"}</button>
      {orders.length === 0 ? <p style={{ color: "#888" }}>No hay pedidos pagados todavía.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {orders.map((o) => (
            <li key={o.sellerOrderId} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span><strong>#{o.orderId.slice(0, 8)}</strong> <span style={{ color: "#999", fontSize: 13 }}>· {o.itemCount} ítem(s) · {money(o.subtotalMinor, o.currency)}</span></span>
                <span style={{ background: COLOR[o.status] ?? "#777", color: "white", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{o.status}</span>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(NEXT[o.status] ?? []).length === 0 ? <span style={{ color: "#aaa", fontSize: 13 }}>— sin acciones —</span>
                  : (NEXT[o.status] ?? []).map((to) => (
                    <button key={to} onClick={() => transition(o.sellerOrderId, to)} style={to === "rejected" || to === "delivery_failed" ? { ...btn, background: "#c62828" } : btn}>{LABEL[to] ?? to}</button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      <button onClick={load} style={{ ...btnGhost, justifySelf: "start" }}>{loading ? "…" : "Actualizar"}</button>

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
};

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
    } catch (e) { setLoading(false); onError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    onError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/merchant/branding?tenant=${encodeURIComponent(tenant ?? "")}`, {
        method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(theme),
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
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
          <button onClick={save} disabled={saving} style={btn}>{saving ? "Guardando…" : "Guardar diseño"}</button>
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
