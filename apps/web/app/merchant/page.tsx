"use client";

import { useCallback, useEffect, useState } from "react";

interface SellerOrder {
  sellerOrderId: string;
  orderId: string;
  status: string;
  subtotalMinor: string;
  currency: string;
  itemCount: number;
  createdAt: string;
}

const NEXT: Record<string, string[]> = {
  pending: ["preparing", "rejected"],
  preparing: ["ready"],
  ready: ["in_transit"],
  in_transit: ["delivered", "delivery_failed"],
  delivery_failed: ["in_transit"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

const LABEL: Record<string, string> = {
  preparing: "Preparar",
  ready: "Listo",
  in_transit: "En camino",
  delivered: "Entregado",
  delivery_failed: "Entrega fallida",
  rejected: "Rechazar",
};

const COLOR: Record<string, string> = {
  pending: "#b26a00",
  preparing: "#1a73e8",
  ready: "#8e24aa",
  in_transit: "#00796b",
  delivered: "#2e7d32",
  delivery_failed: "#c62828",
  rejected: "#c62828",
  cancelled: "#777",
};

function money(minor: string, currency = "ARS"): string {
  return (Number(minor) / 100).toLocaleString("es-AR", { style: "currency", currency });
}

export default function MerchantPanel() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState<string>("");
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tenant");
    setTenant(t);
    try {
      const saved = localStorage.getItem("merchantToken") ?? "";
      setToken(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!tenant || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/merchant/orders?tenant=${encodeURIComponent(tenant)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "error");
      else setOrders(data.orders);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tenant, token]);

  useEffect(() => {
    if (token && tenant) void load();
  }, [token, tenant, load]);

  async function transition(id: string, to: string) {
    if (!tenant) return;
    setError(null);
    const res = await fetch(`/api/merchant/orders/${id}/transition?tenant=${encodeURIComponent(tenant)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ to }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "error");
    }
    await load();
  }

  function saveToken() {
    try {
      localStorage.setItem("merchantToken", tokenInput);
    } catch {
      /* ignore */
    }
    setToken(tokenInput);
  }

  if (!token) {
    return (
      <main style={{ maxWidth: 480, margin: "12vh auto", padding: 16 }}>
        <h1 style={{ fontSize: 20 }}>Panel del comercio</h1>
        <p style={{ color: "#666" }}>
          Ingresá el token de acceso (por ahora el <code>ADMIN_API_TOKEN</code>; el login de staff con
          RBAC + MFA es el paso siguiente).
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="token"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc" }}
          />
          <button onClick={saveToken} style={btn}>Entrar</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Pedidos {tenant ? `· ${tenant}` : ""}</h1>
        <span>
          <button onClick={load} style={{ ...btn, marginRight: 8 }}>{loading ? "…" : "Actualizar"}</button>
          <button
            onClick={() => { try { localStorage.removeItem("merchantToken"); } catch { /* */ } setToken(""); }}
            style={{ ...btn, background: "#eee", color: "#333" }}
          >
            Salir
          </button>
        </span>
      </div>

      {error && <p style={{ color: "#c00" }}>Error: {error}</p>}

      {orders.length === 0 ? (
        <p style={{ color: "#888" }}>No hay pedidos pagados todavía. Comprá algo desde la tienda y confirmá el pago.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {orders.map((o) => (
            <li key={o.sellerOrderId} style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong>#{o.orderId.slice(0, 8)}</strong>{" "}
                  <span style={{ color: "#999", fontSize: 13 }}>· {o.itemCount} ítem(s) · {money(o.subtotalMinor, o.currency)}</span>
                </span>
                <span style={{ background: COLOR[o.status] ?? "#777", color: "white", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>
                  {o.status}
                </span>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(NEXT[o.status] ?? []).length === 0 ? (
                  <span style={{ color: "#aaa", fontSize: 13 }}>— sin acciones —</span>
                ) : (
                  (NEXT[o.status] ?? []).map((to) => (
                    <button key={to} onClick={() => transition(o.sellerOrderId, to)} style={to === "rejected" || to === "delivery_failed" ? btnDanger : btn}>
                      {LABEL[to] ?? to}
                    </button>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const btn: React.CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 600, cursor: "pointer" };
const btnDanger: React.CSSProperties = { ...btn, background: "#c62828" };
