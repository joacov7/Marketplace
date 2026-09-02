"use client";

import { useEffect, useState } from "react";

export interface StoreProduct {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  imageUrl?: string;
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
  font?: "system" | "serif" | "rounded" | "mono";
  buttonShape?: "rounded" | "pill" | "square";
  whatsapp?: string;
  whatsappMessage?: string;
  agentEnabled: boolean;
  products: StoreProduct[];
}) {
  const { tenant, primary } = props;
  const layout = props.layout ?? "grid";
  const fontFamily = FONT_STACKS[props.font ?? "system"];
  const btnRadius = BUTTON_RADIUS[props.buttonShape ?? "rounded"];
  const waLink = props.whatsapp
    ? `https://wa.me/${props.whatsapp}?text=${encodeURIComponent(props.whatsappMessage ?? "¡Hola! Quiero hacer un pedido.")}`
    : null;
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
    <div style={{ background: "#f6f7f9", minHeight: "100vh", fontFamily, ["--btn-radius" as string]: btnRadius } as React.CSSProperties}>
      <style>{STORE_CSS}</style>
      {props.font === "rounded" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" />}
      {props.font === "mono" && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" />}
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "16px 16px 40px" }}>
      <header
        style={{
          color: "white",
          padding: "28px 22px",
          borderRadius: 16,
          marginBottom: 20,
          boxShadow: "0 8px 30px rgba(0,0,0,.10)",
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
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.02em" }}>{props.displayName}</h1>
          </div>
          <AccountWidget tenant={tenant} />
        </div>
        <p style={{ margin: "10px 0 0", opacity: 0.92, fontSize: 16 }}>{props.bannerText && props.bannerText.length > 0 ? props.bannerText : "¿Qué necesitás para tu mascota?"}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="pbtn" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#25D366", color: "white", textDecoration: "none", borderRadius: 999, padding: "9px 18px", fontWeight: 700 }}>
              <WhatsAppIcon size={18} /> Hacé tu pedido por WhatsApp
            </a>
          )}
          {props.agentEnabled && (
            <button
              onClick={() => setAgentOpen((v) => !v)}
              className="pbtn"
              style={{ background: "white", color: primary, border: "none", borderRadius: 999, padding: "9px 16px", fontWeight: 600, cursor: "pointer" }}
            >
              🐾 {agentOpen ? "Cerrar asistente" : "Preguntar al agente"}
            </button>
          )}
        </div>
      </header>

      {agentOpen && <AgentPanel tenant={tenant} primary={primary} onAdd={add} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
        <section>
          <h2 style={sectionTitle}>Productos <span style={{ color: "#aaa", fontWeight: 500, fontSize: 14 }}>({props.products.length})</span></h2>
          {props.products.length === 0 ? (
            <p style={{ color: "#888" }}>Todavía no hay productos cargados.</p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: 14,
                gridTemplateColumns: layout === "grid" ? "repeat(auto-fill, minmax(180px, 1fr))" : "1fr",
              }}
            >
              {props.products.map((p) => (
                <ProductCard key={p.variantId} p={p} layout={layout} primary={primary} inCart={cart[p.variantId]?.qty ?? 0} onAdd={add} onSetQty={setQty} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 style={sectionTitle}>Carrito</h2>
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
                <button className="pbtn" onClick={startCheckout} style={{ ...btn(primary), width: "100%", marginTop: 12, padding: "11px" }}>
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
                <button className="pbtn" onClick={() => setCheckingOut(false)} style={{ ...btn("#94969c"), flex: 1 }}>Volver</button>
                <button className="pbtn" onClick={pay} disabled={busy} style={{ ...btn(primary), flex: 2 }}>
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

      <footer style={{ marginTop: 32, color: "#b0b0b8", fontSize: 12, textAlign: "center" }}>{props.displayName} · Commerce OS</footer>
      </main>
      {waLink && (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Escribinos por WhatsApp"
          style={{ position: "fixed", right: 18, bottom: 18, width: 58, height: 58, borderRadius: "50%", background: "#25D366", color: "white", display: "grid", placeItems: "center", textDecoration: "none", boxShadow: "0 6px 20px rgba(0,0,0,.25)", zIndex: 50 }}
        >
          <WhatsAppIcon size={32} />
        </a>
      )}
    </div>
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
  border: "1px solid #ececef",
  borderRadius: 12,
  padding: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  boxShadow: "0 1px 3px rgba(0,0,0,.04)",
};

const sectionTitle: React.CSSProperties = { fontSize: 18, color: "#1e293b", letterSpacing: "-0.01em", margin: "0 0 12px" };

/** CSS mínimo para hover/transiciones (los estilos inline no soportan :hover). */
const STORE_CSS = `
.pcard{transition:box-shadow .18s ease, transform .18s ease;}
.pcard:hover{box-shadow:0 8px 24px rgba(0,0,0,.10); transform:translateY(-2px);}
.pbtn{transition:filter .15s ease, transform .05s ease;}
.pbtn:hover{filter:brightness(1.07);}
.pbtn:active{transform:scale(.97);}
.pimg{transition:transform .25s ease;}
.pcard:hover .pimg{transform:scale(1.03);}
`;

/** Logo de WhatsApp (SVG inline, hereda el color con fill="currentColor"). */
function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden focusable="false">
      <path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.6c1.7.9 3.7 1.4 5.6 1.4h.2c6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.7 0-3.4-.5-4.9-1.3l-.4-.2-4.9 1 1-4.8-.3-.5C5.6 18.4 5 16.7 5 15 5 9 9.9 4.1 16 4.1S27 9 27 15s-4.9 9.8-11 9.8zm6-7.3c-.3-.2-1.9-1-2.2-1.1-.3-.1-.5-.2-.8.2s-.9 1.1-1.1 1.3c-.2.2-.4.2-.7.1-1.7-.9-2.9-1.6-4-3.6-.3-.5.3-.5.8-1.6.1-.2 0-.4 0-.6s-.8-1.9-1.1-2.6c-.3-.6-.6-.5-.8-.6h-.7c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.9.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z" />
    </svg>
  );
}

/** Miniatura/foto de producto. En grilla ocupa el ancho; en lista es un cuadrado chico. */
function Thumb({ src, alt, layout }: { src?: string; alt: string; layout: "grid" | "list" }) {
  const size = layout === "grid" ? { width: "100%", height: 160 } : { width: 60, height: 60, flexShrink: 0 };
  const common: React.CSSProperties = { ...size, borderRadius: 10, objectFit: "cover", background: "#f1f1f3", display: "block" };
  if (!src) {
    return <span style={{ ...common, display: "grid", placeItems: "center", fontSize: layout === "grid" ? 44 : 26 }}>🐾</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="pimg" src={src} alt={alt} style={common} />;
}

/** Tarjeta de producto. Grilla = card vertical (foto, nombre, precio+acción). Lista = fila. */
function ProductCard({
  p, layout, primary, inCart, onAdd, onSetQty,
}: {
  p: StoreProduct;
  layout: "grid" | "list";
  primary: string;
  inCart: number;
  onAdd: (variantId: string, name: string, priceMinor: number) => void;
  onSetQty: (variantId: string, qty: number) => void;
}) {
  const price = p.priceMinor ? money(Number(p.priceMinor), p.currency ?? "ARS") : "—";
  const addFn = () => onAdd(p.variantId, `${p.productName} ${p.variantName}`, Number(p.priceMinor));
  const stepper = (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <button className="pbtn" onClick={() => onSetQty(p.variantId, inCart - 1)} style={qtyBtn} aria-label="Quitar uno">−</button>
      <span style={{ minWidth: 18, textAlign: "center", fontWeight: 600 }}>{inCart}</span>
      <button className="pbtn" onClick={() => onSetQty(p.variantId, inCart + 1)} style={qtyBtn} aria-label="Agregar uno">+</button>
    </span>
  );

  if (layout === "list") {
    return (
      <li className="pcard" style={{ ...cardStyle, gap: 14 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <Thumb src={p.imageUrl} alt={p.productName} layout="list" />
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block" }}>{p.productName}</strong>
            <span style={{ color: "#9aa0aa", fontSize: 13 }}>{p.variantName} · {p.sku}</span>
          </span>
        </span>
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <b style={{ fontSize: 16, whiteSpace: "nowrap" }}>{price}</b>
          {p.priceMinor && (inCart > 0 ? stepper : <button className="pbtn" onClick={addFn} style={btn(primary)}>Agregar</button>)}
        </span>
      </li>
    );
  }

  return (
    <li className="pcard" style={{ ...cardStyle, flexDirection: "column", alignItems: "stretch", gap: 10, padding: 12, overflow: "hidden" }}>
      <span style={{ overflow: "hidden", borderRadius: 10 }}><Thumb src={p.imageUrl} alt={p.productName} layout="grid" /></span>
      <span style={{ minHeight: 40 }}>
        <strong style={{ display: "block", lineHeight: 1.25 }}>{p.productName}</strong>
        <span style={{ color: "#9aa0aa", fontSize: 12 }}>{p.variantName}</span>
      </span>
      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <b style={{ fontSize: 17 }}>{price}</b>
        {p.priceMinor && (inCart > 0 ? stepper : <button className="pbtn" onClick={addFn} style={btn(primary)}>Agregar</button>)}
      </span>
    </li>
  );
}
/** Familias tipográficas configurables (branding.font). Fallbacks siempre presentes. */
const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  rounded: "'Nunito', 'Quicksand', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
};
/** Radio de los botones según branding.buttonShape. */
const BUTTON_RADIUS: Record<string, string> = { rounded: "10px", pill: "999px", square: "4px" };

function btn(primary: string): React.CSSProperties {
  return { background: primary, color: "white", border: "none", borderRadius: "var(--btn-radius, 10px)", padding: "8px 14px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
}
const qtyBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: "1px solid #dcdce0", background: "#fafafa", cursor: "pointer", fontSize: 16, lineHeight: 1 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc", marginBottom: 6 };
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
