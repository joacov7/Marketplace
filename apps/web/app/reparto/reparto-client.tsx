"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bike, RefreshCw, CheckCircle2, Check, MapPin, StickyNote, Clock,
  Navigation, MessageCircle, Banknote, CreditCard, Landmark,
} from "lucide-react";

interface DeliveryItem { name: string; variant: string; qty: number }
interface DeliveryOrder {
  sellerOrderId: string;
  orderId: string;
  status: "ready" | "in_transit";
  petName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  addressStreet: string | null;
  addressZone: string | null;
  addressNotes: string | null;
  addressLat: number | null;
  addressLng: number | null;
  deliveryWindow: string | null;
  amountToCollectMinor: string;
  paymentMethod: string | null;
  paymentStatus: string;
  items: DeliveryItem[];
}

const money = (m: string | number) => (Number(m) / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const METHOD: Record<string, string> = { online: "Online", efectivo: "Efectivo", pos: "Tarjeta (POS)", transferencia: "Transferencia" };

const C = { green: "#2E7D32", ink: "#1c2024", mut: "#6b7280", line: "#e6e7ea", bg: "#f5f6f7", white: "#fff", warn: "#b26a00", blue: "#1a73e8" };

export default function RepartoClient() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectFor, setCollectFor] = useState<string | null>(null); // sellerOrderId en modo cobro

  useEffect(() => {
    setTenant(new URLSearchParams(window.location.search).get("tenant"));
    try { setToken(localStorage.getItem("deliveryToken") ?? ""); } catch { /* */ }
  }, []);

  const auth = { authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!tenant || !token) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/delivery/orders?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "error"); setOrders([]); }
      else setOrders(d.orders);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);

  useEffect(() => { if (token && tenant) void load(); }, [token, tenant, load]);

  function saveToken() { try { localStorage.setItem("deliveryToken", tokenInput); } catch { /* */ } setToken(tokenInput); }

  async function toTransit(id: string) {
    const res = await fetch(`/api/delivery/orders/${id}/status?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ to: "in_transit" }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "error"); }
    await load();
  }
  async function failed(id: string) {
    const res = await fetch(`/api/delivery/orders/${id}/status?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ to: "delivery_failed" }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "error"); }
    await load();
  }
  async function deliver(id: string, collect: string) {
    const res = await fetch(`/api/delivery/orders/${id}/deliver?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ collect }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "error"); }
    setCollectFor(null);
    await load();
  }

  const title = (o: DeliveryOrder) => (o.petName ? `Pedido de ${o.petName}` : `Pedido #${o.orderId.slice(0, 8)}`);
  const mapsLink = (o: DeliveryOrder) => {
    // Si el cliente compartió su ubicación, vamos al pin exacto; si no, a la dirección escrita.
    if (o.addressLat != null && o.addressLng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${o.addressLat},${o.addressLng}`;
    }
    const q = [o.addressStreet, o.addressZone, "Gualeguay, Entre Ríos"].filter(Boolean).join(", ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  };
  const waLink = (o: DeliveryOrder) => {
    const digits = (o.customerPhone ?? "").replace(/\D+/g, "");
    if (!digits) return null;
    const msg = `¡Hola${o.customerName ? " " + o.customerName : ""}! Soy del Pet Shop, estoy llevando ${o.petName ? "el pedido de " + o.petName : "tu pedido"}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  };

  if (!token) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", background: C.bg, minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
        <div style={{ background: C.white, borderRadius: 16, padding: 26, width: "100%", maxWidth: 360, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
          <div style={{ textAlign: "center", color: C.green }}><Bike size={34} strokeWidth={1.8} /></div>
          <h1 style={{ fontSize: 22, textAlign: "center", margin: "8px 0 4px", color: C.ink }}>Reparto</h1>
          <p style={{ color: C.mut, fontSize: 13.5, textAlign: "center", marginTop: 0 }}>Ingresá tu PIN de reparto.</p>
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveToken()}
            placeholder="PIN" inputMode="numeric" type="password" style={{ width: "100%", padding: 14, borderRadius: 11, border: `1px solid ${C.line}`, fontSize: 16 }} />
          <button onClick={saveToken} style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 11, border: "none", background: C.green, color: "white", fontWeight: 700, fontSize: 15 }}>Entrar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: C.bg, minHeight: "100vh", color: C.ink }}>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: C.green, color: "white", padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Entregas de hoy</div>
          <div style={{ fontSize: 12.5, opacity: 0.9 }}>{orders.length} para repartir</div>
        </div>
        <button onClick={load} style={{ background: "rgba(255,255,255,.2)", color: "white", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 14 }} aria-label="Actualizar">{loading ? "…" : <RefreshCw size={16} strokeWidth={2} />}</button>
      </header>

      <main style={{ padding: 14, maxWidth: 560, margin: "0 auto" }}>
        {error && <div style={{ background: "#fdecea", color: "#b3261e", borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {orders.length === 0 && !loading ? (
          <div style={{ textAlign: "center", color: C.mut, padding: "60px 20px" }}>
            <div style={{ color: C.green }}><CheckCircle2 size={40} strokeWidth={1.7} /></div>
            <p>No hay entregas pendientes.<br />Los pedidos aparecen acá cuando el local los marca <b>Listos</b>.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {orders.map((o) => {
              const paid = o.paymentStatus === "pagado";
              const collecting = collectFor === o.sellerOrderId;
              const wa = waLink(o);
              return (
                <div key={o.sellerOrderId} style={{ background: C.white, borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)", overflow: "hidden" }}>
                  <div style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>{title(o)}</div>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: "white", background: o.status === "in_transit" ? C.blue : C.warn, borderRadius: 999, padding: "3px 10px", flexShrink: 0 }}>
                        {o.status === "in_transit" ? "En camino" : "Listo"}
                      </span>
                    </div>
                    {o.customerName && <div style={{ fontSize: 13.5, color: C.mut, marginTop: 2 }}>{o.customerName}</div>}

                    {/* Dirección + referencias */}
                    <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><MapPin size={16} strokeWidth={1.9} style={{flexShrink:0,marginTop:2}} /><span><b>{o.addressStreet ?? "Sin dirección"}</b>{o.addressZone ? ` · ${o.addressZone}` : ""}{o.addressLat != null && <span style={{ color: C.green, fontWeight: 600 }}> · ubicación exacta</span>}</span></div>
                      {o.addressNotes && <div style={{ color: C.mut, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><StickyNote size={14} strokeWidth={1.8} style={{flexShrink:0}} />{o.addressNotes}</div>}
                      {o.deliveryWindow && <div style={{ color: C.mut, fontSize: 12.5, marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}><Clock size={13} strokeWidth={1.8} style={{flexShrink:0}} />{o.deliveryWindow}</div>}
                    </div>

                    {/* Items */}
                    {o.items.length > 0 && (
                      <div style={{ marginTop: 10, fontSize: 13, color: C.ink, background: C.bg, borderRadius: 9, padding: "8px 11px" }}>
                        {o.items.map((it, i) => <div key={i}>{it.qty}× {it.name} · {it.variant}</div>)}
                      </div>
                    )}

                    {/* Cobro */}
                    <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, color: C.mut }}>A cobrar</span>
                      <span style={{ fontSize: 20, fontWeight: 800, color: C.green }}>{money(o.amountToCollectMinor)}</span>
                    </div>
                    <div style={{ fontSize: 12.5, marginTop: 2, color: paid ? C.green : C.warn, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                      {paid && <Check size={14} strokeWidth={2.2} />}
                      {paid ? `Ya pagó${o.paymentMethod ? ` (${METHOD[o.paymentMethod] ?? o.paymentMethod})` : ""}` : `Pago pendiente${o.paymentMethod ? ` · ${METHOD[o.paymentMethod] ?? o.paymentMethod}` : ""}`}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div style={{ borderTop: `1px solid ${C.line}`, padding: 12, display: "grid", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: wa ? "1fr 1fr" : "1fr", gap: 8 }}>
                      <a href={mapsLink(o)} target="_blank" rel="noopener noreferrer" style={btn(C.blue)}><Navigation size={16} style={{verticalAlign:"-3px",marginRight:6}} />Cómo llegar</a>
                      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={btn("#25D366")}><MessageCircle size={16} style={{verticalAlign:"-3px",marginRight:6}} />WhatsApp</a>}
                    </div>

                    {o.status === "ready" && (
                      <button onClick={() => toTransit(o.sellerOrderId)} style={{ ...btn(C.green), border: "none", cursor: "pointer", width: "100%" }}><Bike size={16} style={{verticalAlign:"-3px",marginRight:6}} />Salir a entregar</button>
                    )}

                    {o.status === "in_transit" && !collecting && (
                      <button onClick={() => (paid ? deliver(o.sellerOrderId, "ya_pago") : setCollectFor(o.sellerOrderId))}
                        style={{ ...btn(C.green), border: "none", cursor: "pointer", width: "100%" }}><CheckCircle2 size={16} style={{verticalAlign:"-3px",marginRight:6}} />Marcar entregado</button>
                    )}

                    {o.status === "in_transit" && collecting && (
                      <div style={{ background: C.bg, borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>¿Cómo cobraste {money(o.amountToCollectMinor)}?</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <button onClick={() => deliver(o.sellerOrderId, "efectivo")} style={collectBtn}><Banknote size={15} style={{verticalAlign:"-3px",marginRight:6}} />Efectivo</button>
                          <button onClick={() => deliver(o.sellerOrderId, "pos")} style={collectBtn}><CreditCard size={15} style={{verticalAlign:"-3px",marginRight:6}} />Tarjeta (POS)</button>
                          <button onClick={() => deliver(o.sellerOrderId, "transferencia")} style={collectBtn}><Landmark size={15} style={{verticalAlign:"-3px",marginRight:6}} />Transferencia</button>
                          <button onClick={() => deliver(o.sellerOrderId, "ya_pago")} style={collectBtn}><Check size={15} style={{verticalAlign:"-3px",marginRight:6}} />Ya había pagado</button>
                        </div>
                        <button onClick={() => setCollectFor(null)} style={{ ...collectBtn, marginTop: 8, width: "100%", background: "transparent", color: C.mut, border: "none" }}>Cancelar</button>
                      </div>
                    )}

                    {o.status === "in_transit" && !collecting && (
                      <button onClick={() => failed(o.sellerOrderId)} style={{ background: "transparent", color: "#b3261e", border: "none", fontSize: 12.5, fontWeight: 600, padding: 6, cursor: "pointer" }}>No pude entregar</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p style={{ textAlign: "center", color: C.mut, fontSize: 11.5, marginTop: 24 }}>Pet Shop · Reparto</p>
      </main>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: "white", borderRadius: 10, padding: "12px 10px", fontWeight: 700, fontSize: 14, textAlign: "center", textDecoration: "none", display: "block" };
}
const collectBtn: React.CSSProperties = { background: "white", border: "1px solid #d4d6dc", borderRadius: 9, padding: "12px 8px", fontWeight: 600, fontSize: 13.5, cursor: "pointer" };
