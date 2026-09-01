"use client";

import { useCallback, useEffect, useState } from "react";

interface Merchant { id: string; slug: string; name: string }
interface SellerOrder { sellerOrderId: string; orderId: string; status: string; subtotalMinor: string; currency: string; itemCount: number; createdAt: string }
interface CatalogItem { variantId: string; productName: string; variantName: string; sku: string; priceMinor: string | null; currency: string | null; available: number; status: string }

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
  const [tab, setTab] = useState<"catalogo" | "pedidos">("catalogo");
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
        {(["catalogo", "pedidos"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btnGhost, background: tab === t ? "#2563eb" : "#eee", color: tab === t ? "white" : "#333", borderRadius: "8px 8px 0 0" }}>
            {t === "catalogo" ? "Catálogo" : "Pedidos"}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#c00" }}>Error: {error}</p>}

      {tab === "catalogo"
        ? <CatalogTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : <OrdersTab tenant={tenant} token={token} onError={setError} />}
    </main>
  );
}

function CatalogTab({ tenant, token, merchantId, onError }: { tenant: string | null; token: string; merchantId: string; onError: (s: string | null) => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [f, setF] = useState({ productName: "", sku: "", price: "", stock: "" });
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
      body: JSON.stringify({ merchantId, productName: f.productName, sku: f.sku, priceMinor: Math.round(Number(f.price) * 100), stock: Number(f.stock || 0) }),
    });
    const data = await res.json();
    if (!res.ok) { onError(data.error); return; }
    setF({ productName: "", sku: "", price: "", stock: "" });
    await load();
  }

  async function save(variantId: string, priceMinor: number | null, stock: number) {
    await fetch(`/api/merchant/catalog/${variantId}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...(priceMinor !== null ? { priceMinor } : {}), stock }),
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

function CatalogRow({ it, onSave }: { it: CatalogItem; onSave: (variantId: string, priceMinor: number | null, stock: number) => void }) {
  const [price, setPrice] = useState(it.priceMinor ? String(Number(it.priceMinor) / 100) : "");
  const [stock, setStock] = useState(String(it.available));
  return (
    <li style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <span><strong>{it.productName}</strong> <span style={{ color: "#999", fontSize: 13 }}>{it.variantName} · {it.sku}</span></span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "#777" }}>$ <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...input, width: 90 }} /></label>
        <label style={{ fontSize: 12, color: "#777" }}>Stock <input value={stock} onChange={(e) => setStock(e.target.value)} style={{ ...input, width: 70 }} /></label>
        <button onClick={() => onSave(it.variantId, price ? Math.round(Number(price) * 100) : null, Number(stock))} style={btn}>Guardar</button>
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
