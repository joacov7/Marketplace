"use client";

import { useEffect, useState } from "react";

export interface StoreProduct {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  priceMinor: string | null;
  currency: string | null;
}

interface CartItem {
  name: string;
  priceMinor: number;
  qty: number;
}
type Cart = Record<string, CartItem>;

function money(minor: number, currency = "ARS"): string {
  return (minor / 100).toLocaleString("es-AR", { style: "currency", currency });
}

export default function Storefront(props: {
  tenant: string;
  displayName: string;
  primary: string;
  secondary?: string;
  logoUrl?: string;
  bannerText?: string;
  bannerImageUrl?: string;
  layout?: "grid" | "list";
  agentEnabled: boolean;
  products: StoreProduct[];
}) {
  const { tenant, primary } = props;
  const layout = props.layout ?? "grid";
  const [cart, setCart] = useState<Cart>({});
  const [agentOpen, setAgentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<{ orderId: string; providerRef: string; totalMinor: string } | null>(null);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [quote, setQuote] = useState<{ gmvMinor: string; deliveryChargeMinor: string; totalMinor: string } | null>(null);
  const [addr, setAddr] = useState({ street: "", city: "", zone: "", notes: "" });
  const [win, setWin] = useState("Hoy 14–18 h");

  const storageKey = `cart:${tenant}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setCart(JSON.parse(raw) as Cart);
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, storageKey]);

  const items = Object.entries(cart);
  const total = items.reduce((a, [, i]) => a + i.priceMinor * i.qty, 0);

  function add(variantId: string, name: string, priceMinor: number) {
    setOrder(null);
    setPaid(false);
    setCart((c) => ({ ...c, [variantId]: { name, priceMinor, qty: (c[variantId]?.qty ?? 0) + 1 } }));
  }
  function setQty(variantId: string, qty: number) {
    setCart((c) => {
      if (qty <= 0) {
        const { [variantId]: _drop, ...rest } = c;
        return rest;
      }
      return { ...c, [variantId]: { ...c[variantId]!, qty } };
    });
  }

  async function startCheckout() {
    setError(null);
    setCheckingOut(true);
    setQuote(null);
    try {
      const res = await fetch(`/api/checkout/quote?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: items.map(([variantId, i]) => ({ variantId, qty: i.qty })) }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "error");
      else setQuote(data);
    } catch (e) {
      setError(String(e));
    }
  }

  async function pay() {
    if (!addr.street.trim()) { setError("Ingresá una dirección de entrega"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ items: items.map(([variantId, i]) => ({ variantId, qty: i.qty })), address: addr, deliveryWindow: win }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "error en el checkout");
      else { setOrder({ orderId: data.orderId, providerRef: data.providerRef, totalMinor: data.totalMinor }); setCheckingOut(false); }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function simulatePay() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/webhooks/payments/sim?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": "valid" },
        body: JSON.stringify({ providerEventId: crypto.randomUUID(), providerRef: order.providerRef, type: "payment.approved" }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "error confirmando el pago");
      else {
        setPaid(true);
        setCart({});
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: 16 }}>
      <header
        style={{
          color: "white",
          padding: "20px 16px",
          borderRadius: 12,
          marginBottom: 16,
          background: props.bannerImageUrl
            ? `linear-gradient(135deg, ${primary}dd, ${(props.secondary ?? primary)}cc), url("${props.bannerImageUrl}") center/cover`
            : `linear-gradient(135deg, ${primary}, ${props.secondary ?? primary})`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {props.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={props.logoUrl} alt={props.displayName} style={{ height: 40, width: 40, objectFit: "contain", borderRadius: 8, background: "rgba(255,255,255,.9)", padding: 4 }} />
            )}
            <h1 style={{ margin: 0, fontSize: 22 }}>{props.displayName}</h1>
          </div>
          <AccountWidget tenant={tenant} />
        </div>
        <p style={{ margin: "6px 0 0", opacity: 0.9 }}>{props.bannerText && props.bannerText.length > 0 ? props.bannerText : "¿Qué necesitás para tu mascota?"}</p>
        {props.agentEnabled && (
          <button
            onClick={() => setAgentOpen((v) => !v)}
            style={{ marginTop: 12, background: "white", color: primary, border: "none", borderRadius: 999, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            🐾 {agentOpen ? "Cerrar asistente" : "Preguntar al agente"}
          </button>
        )}
      </header>

      {agentOpen && <AgentPanel tenant={tenant} primary={primary} onAdd={add} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <section>
          <h2 style={{ fontSize: 16, color: "#444" }}>Productos</h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              display: "grid",
              gap: 10,
              gridTemplateColumns: layout === "grid" ? "repeat(auto-fill, minmax(200px, 1fr))" : "1fr",
            }}
          >
            {props.products.map((p) => (
              <li
                key={p.variantId}
                style={
                  layout === "grid"
                    ? { ...cardStyle, flexDirection: "column", alignItems: "stretch", gap: 10 }
                    : cardStyle
                }
              >
                <span>
                  <strong>{p.productName}</strong>
                  <span style={{ color: "#999", marginLeft: 8, fontSize: 13 }}>
                    {p.variantName} · {p.sku}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: layout === "grid" ? "space-between" : undefined }}>
                  <b>{p.priceMinor ? money(Number(p.priceMinor), p.currency ?? "ARS") : "—"}</b>
                  {p.priceMinor && (
                    <button onClick={() => add(p.variantId, `${p.productName} ${p.variantName}`, Number(p.priceMinor))} style={btn(primary)}>
                      Agregar
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 style={{ fontSize: 16, color: "#444" }}>Carrito</h2>
          {items.length === 0 ? (
            <p style={{ color: "#888" }}>Tu carrito está vacío.</p>
          ) : (
            <div style={{ ...cardStyle, display: "block" }}>
              {items.map(([variantId, i]) => (
                <div key={variantId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                  <span>{i.name}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => setQty(variantId, i.qty - 1)} style={qtyBtn}>−</button>
                    <span style={{ minWidth: 20, textAlign: "center" }}>{i.qty}</span>
                    <button onClick={() => setQty(variantId, i.qty + 1)} style={qtyBtn}>+</button>
                    <b style={{ minWidth: 90, textAlign: "right" }}>{money(i.priceMinor * i.qty)}</b>
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8, fontWeight: 700 }}>
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
              {!order && !checkingOut && (
                <button onClick={startCheckout} style={{ ...btn(primary), width: "100%", marginTop: 12, padding: "10px" }}>
                  Finalizar compra
                </button>
              )}
            </div>
          )}

          {checkingOut && !order && (
            <div style={{ ...cardStyle, display: "block", marginTop: 10 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Datos de entrega</h3>
              <input placeholder="Dirección (calle y número)" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} style={inp} />
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Ciudad" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} style={{ ...inp, flex: 1 }} />
                <input placeholder="Zona/barrio" value={addr.zone} onChange={(e) => setAddr({ ...addr, zone: e.target.value })} style={{ ...inp, flex: 1 }} />
              </div>
              <input placeholder="Notas (timbre, referencia…)" value={addr.notes} onChange={(e) => setAddr({ ...addr, notes: e.target.value })} style={inp} />
              <label style={{ display: "block", fontSize: 13, color: "#555", margin: "6px 0 2px" }}>Ventana de entrega</label>
              <select value={win} onChange={(e) => setWin(e.target.value)} style={inp}>
                {["Hoy 14–18 h", "Hoy 18–21 h", "Mañana 10–14 h", "Mañana 14–18 h"].map((w) => <option key={w}>{w}</option>)}
              </select>

              {quote && (
                <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 8, fontSize: 14 }}>
                  <Row label="Subtotal" value={money(Number(quote.gmvMinor))} />
                  <Row label="Envío" value={Number(quote.deliveryChargeMinor) === 0 ? "Gratis" : money(Number(quote.deliveryChargeMinor))} />
                  <Row label="Total" value={money(Number(quote.totalMinor))} bold />
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={() => setCheckingOut(false)} style={{ ...btn("#888"), flex: 1 }}>Volver</button>
                <button onClick={pay} disabled={busy} style={{ ...btn(primary), flex: 2 }}>
                  {busy ? "Procesando…" : quote ? `Pagar ${money(Number(quote.totalMinor))}` : "Pagar"}
                </button>
              </div>
            </div>
          )}

          {order && !paid && (
            <div style={{ ...cardStyle, display: "block", marginTop: 10, background: "#fff8e1", borderColor: "#f0e0a0" }}>
              <p style={{ margin: 0 }}>
                Pedido <code>{order.orderId.slice(0, 8)}</code> creado — <b>pendiente de pago</b> ({money(Number(order.totalMinor))}).
              </p>
              <button onClick={simulatePay} disabled={busy} style={{ ...btn(primary), marginTop: 10 }}>
                {busy ? "…" : "Simular pago aprobado"}
              </button>
              <p style={{ color: "#999", fontSize: 12, marginBottom: 0 }}>
                (En producción esto lo dispara el webhook de Mercado Pago.)
              </p>
            </div>
          )}

          {paid && (
            <div style={{ ...cardStyle, display: "block", marginTop: 10, background: "#e6f4ea", borderColor: "#a8d5b5" }}>
              <p style={{ margin: 0 }}>✅ <b>¡Pago confirmado!</b> El pedido pasó a preparación y se descontó el stock.</p>
            </div>
          )}

          {error && <p style={{ color: "#c00", fontSize: 13 }}>Error: {error}</p>}
        </section>
      </div>

      <footer style={{ marginTop: 28, color: "#aaa", fontSize: 12, textAlign: "center" }}>{props.displayName} · Commerce OS</footer>
    </main>
  );
}

function AccountWidget({ tenant }: { tenant: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setEmail(d.user?.email ?? null)).catch(() => {});
  }, []);

  async function submit() {
    setErr(null);
    const path = mode === "login" ? "login" : "register";
    const res = await fetch(`/api/auth/${path}?tenant=${encodeURIComponent(tenant)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    });
    const d = await res.json();
    if (!res.ok) { setErr(d.error ?? "error"); return; }
    setEmail(d.email); setOpen(false); setForm({ email: "", password: "" });
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setEmail(null);
  }

  if (email) {
    return (
      <span style={{ fontSize: 13, textAlign: "right" }}>
        {email}<br />
        <button onClick={logout} style={{ background: "rgba(255,255,255,.25)", color: "white", border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 12, marginTop: 4 }}>Salir</button>
      </span>
    );
  }
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ background: "rgba(255,255,255,.25)", color: "white", border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
        Ingresar
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 40, background: "white", color: "#111", border: "1px solid #ddd", borderRadius: 10, padding: 12, width: 230, zIndex: 10, boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["login", "register"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{ flex: 1, border: "none", borderRadius: 6, padding: "5px", cursor: "pointer", background: mode === m ? "#2563eb" : "#eee", color: mode === m ? "white" : "#333", fontSize: 12, fontWeight: 600 }}>
                {m === "login" ? "Ingresar" : "Registrarse"}
              </button>
            ))}
          </div>
          <input placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "7px", borderRadius: 6, border: "1px solid #ccc", marginBottom: 6 }} />
          <input placeholder="contraseña" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ width: "100%", boxSizing: "border-box", padding: "7px", borderRadius: 6, border: "1px solid #ccc" }} />
          {err && <p style={{ color: "#c00", fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
          <button onClick={submit} style={{ width: "100%", marginTop: 8, background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "8px", fontWeight: 600, cursor: "pointer" }}>
            {mode === "login" ? "Ingresar" : "Crear cuenta"}
          </button>
        </div>
      )}
    </span>
  );
}

function AgentPanel(props: { tenant: string; primary: string; onAdd: (variantId: string, name: string, priceMinor: number) => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [proposed, setProposed] = useState<{ items: Array<{ variantId: string; name: string; unitPriceMinor: string }>; totalMinor: string } | null>(null);

  async function ask() {
    if (!msg.trim()) return;
    setBusy(true);
    setReply(null);
    setProposed(null);
    try {
      const res = await fetch(`/api/agent/query?tenant=${encodeURIComponent(props.tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setReply(data.reply ?? "…");
      setProposed(data.proposedCart ?? null);
    } catch (e) {
      setReply("Error: " + String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...cardStyle, display: "block", marginBottom: 16, background: "#f4f6ff", borderColor: "#c9d4ff" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ej: comida para mi perro senior"
          style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #ccd" }}
        />
        <button onClick={ask} disabled={busy} style={btn(props.primary)}>{busy ? "…" : "Preguntar"}</button>
      </div>
      {reply && <p style={{ marginBottom: 6 }}>{reply}</p>}
      {proposed && proposed.items.length > 0 && (
        <div>
          <div style={{ fontSize: 13, color: "#555" }}>Carrito sugerido (confirmás vos):</div>
          {proposed.items.map((i) => (
            <div key={i.variantId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
              <span>{i.name}</span>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <b>{money(Number(i.unitPriceMinor))}</b>
                <button onClick={() => props.onAdd(i.variantId, i.name, Number(i.unitPriceMinor))} style={btn(props.primary)}>
                  Agregar
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
function btn(primary: string): React.CSSProperties {
  return { background: primary, color: "white", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 600, cursor: "pointer" };
}
const qtyBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 6, border: "1px solid #ddd", background: "#fafafa", cursor: "pointer" };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", marginBottom: 6 };
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
