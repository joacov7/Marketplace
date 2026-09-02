"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ── Tipos que provee el server component (page.tsx) ────────────────────────────
export interface StoreVariant {
  variantId: string;
  size: string; // nombre de la variante = talle/peso
  priceMinor: string;
  currency: string;
  netWeightKg: number | null; // peso neto de la bolsa (alimentos)
}
export interface StoreProduct {
  productId: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  kcalPerKg: number | null; // densidad energética (alimentos)
  proteinPct: number | null;
  variants: StoreVariant[];
}
export interface StoreCategory {
  name: string;
  position: number;
}
export interface StoreAdoption {
  id: string;
  name: string;
  species: "perro" | "gato" | "otro";
  age: string;
  description: string;
  imageUrl: string;
  contactWhatsapp: string;
}
export interface StoreContent {
  promoText: string;
  heroTitle: string;
  heroHighlight: string;
  heroSubtitle: string;
  footerBlurb: string;
  perks: Array<{ t: string; s: string }>;
  benefits: Array<{ t: string; s: string }>;
}
export interface StoreConfig {
  freeShippingThresholdMinor: string;
  standardCostMinor: string;
  auxilioCostMinor: string;
  transferDiscountPercent: number;
  auxilioEnabled: boolean;
  featuredCount: number;
  listColumns: 2 | 3 | 4;
  foodCalculator: boolean;
  foodComparator: boolean;
  nutritionFactors: Record<string, number>;
}

// ── Design tokens (handoff) ────────────────────────────────────────────────────
const C = {
  greenD: "#256428",
  lightGreen: "#66BB6A",
  beige: "#F5F1E8",
  surf: "#F7F6F2",
  tint: "#F3F8F1",
  iconBg: "#E8F0E4",
  text: "#222222",
  text2: "#5A594F",
  nav: "#4A4A44",
  mute: "#8A8878",
  ph: "#A19E8E",
  border: "#ECEAE3",
  borderBeige: "#E4E1D8",
  borderCart: "#F2F0E9",
  radioOff: "#C9C7BC",
  wa: "#25D366",
  white: "#FFFFFF",
};
const FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Placeholder rayado para imágenes ausentes (mientras no haya foto real).
const PH_BG = "repeating-linear-gradient(45deg,#F0ECE0 0 9px,#F7F4EB 9px 18px)";

const pesos = (minor: number | string) => Math.round(Number(minor) / 100);
const money = (minor: number | string) => "$" + pesos(minor).toLocaleString("es-AR");

// ── Nutrición: fórmula RER/MER (misma que el módulo pets, replicada para el cliente) ──
const ACTIVITY_LABEL: Record<string, string> = {
  cachorro: "Cachorro",
  adulto_bajo: "Adulto poco activo / castrado",
  adulto_normal: "Adulto normal",
  adulto_activo: "Adulto activo",
  senior: "Senior",
};
const DEFAULT_FACTORS: Record<string, number> = { cachorro: 2.0, adulto_bajo: 1.2, adulto_normal: 1.4, adulto_activo: 1.6, senior: 1.2 };
function rer(weightKg: number): number { return weightKg > 0 ? 70 * Math.pow(weightKg, 0.75) : 0; }
function consumption(weightKg: number, factor: number, kcalPerKg: number): { mer: number; gramsPerDay: number; kgPerMonth: number } {
  const mer = factor * rer(weightKg);
  const kpg = kcalPerKg > 0 ? kcalPerKg / 1000 : 0;
  const g = kpg > 0 ? mer / kpg : 0;
  return { mer: Math.round(mer), gramsPerDay: Math.round(g), kgPerMonth: Math.round((g * 30) / 100) / 10 };
}

type View = "home" | "list" | "detail" | "checkout" | "done" | "adopciones" | "comparar";
type CartLine = { name: string; sub: string; priceMinor: number; qty: number };
type Cart = Record<string, CartLine>; // key = variantId

interface Quote {
  gmvMinor: string;
  deliveryChargeMinor: string;
  discountMinor: string;
  totalMinor: string;
  missingForFreeMinor: string;
}

export default function Storefront(props: {
  tenant: string;
  displayName: string;
  primary: string;
  logoUrl: string;
  whatsapp: string;
  whatsappMessage: string;
  products: StoreProduct[];
  categories: StoreCategory[];
  content: StoreContent;
  config: StoreConfig;
  adoptions: StoreAdoption[];
  adoptionsTitle: string;
}) {
  const { tenant, primary, products, config } = props;
  const G = primary; // verde de marca (config)

  const [view, setView] = useState<View>("home");
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string>("");
  const [sizeVariant, setSizeVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [sort, setSort] = useState<"relevancia" | "menor" | "mayor">("relevancia");
  const [delivery, setDelivery] = useState<"estandar" | "auxilio">("estandar");
  const [payment, setPayment] = useState<"transferencia" | "mercadopago" | "efectivo">("transferencia");
  const [form, setForm] = useState({ street: "", zone: "", phone: "", notes: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; totalMinor: string } | null>(null);

  // Carrito persistente por tenant.
  const storageKey = `cart:${tenant}`;
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) setCart(JSON.parse(raw) as Cart); } catch { /* */ }
  }, [storageKey]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch { /* */ }
  }, [cart, storageKey]);

  const go = useCallback((v: View) => { setView(v); if (typeof window !== "undefined") window.scrollTo(0, 0); }, []);

  // ── Categorías: orden real (por position, provisto por el server) con su conteo. ─
  // Solo se muestran las que tienen al menos un producto.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const ordered = props.categories
      .filter((c) => (counts.get(c.name) ?? 0) > 0)
      .map((c) => ({ name: c.name, count: counts.get(c.name)! }));
    // Fallback: categorías presentes en productos pero no en la lista provista.
    for (const [name, count] of counts) if (!props.categories.some((c) => c.name === name)) ordered.push({ name, count });
    return ordered;
  }, [products, props.categories]);

  const defaultVariant = (p: StoreProduct) => p.variants[p.variants.length - 1]!;
  // Alimentos con datos suficientes para comparar (kcal/kg + al menos una bolsa con peso).
  const foodProducts = useMemo(
    () => products.filter((p) => p.kcalPerKg && p.kcalPerKg > 0 && p.variants.some((v) => v.netWeightKg && v.netWeightKg > 0)),
    [products],
  );

  // ── Cálculos de dinero (client-side, desde config; el charge real lo hace /api/checkout) ──
  const items = Object.entries(cart);
  const subtotal = items.reduce((a, [, l]) => a + l.priceMinor * l.qty, 0);
  const threshold = Number(config.freeShippingThresholdMinor);
  const shippingFor = (d: "estandar" | "auxilio") =>
    d === "auxilio" ? Number(config.auxilioCostMinor) : subtotal === 0 || subtotal >= threshold ? 0 : Number(config.standardCostMinor);
  const discountFor = (pm: string) => (pm === "transferencia" ? Math.round(subtotal * (config.transferDiscountPercent / 100)) : 0);
  const missingForFree = Math.max(0, threshold - subtotal);
  const freeShipMsg = subtotal === 0 ? "" : missingForFree > 0 ? `Te faltan ${money(missingForFree)} para el envío gratis` : "¡Envío gratis conseguido!";

  const waLink = (msg?: string) =>
    props.whatsapp ? `https://wa.me/${props.whatsapp}?text=${encodeURIComponent(msg ?? props.whatsappMessage)}` : null;

  // ── Acciones de carrito ──────────────────────────────────────────────────────
  function addToCart(p: StoreProduct, variantId: string, n = 1) {
    const v = p.variants.find((x) => x.variantId === variantId) ?? defaultVariant(p);
    setCart((c) => ({
      ...c,
      [v.variantId]: { name: p.name, sub: `${v.size} · ${p.category || "Producto"}`, priceMinor: Number(v.priceMinor), qty: (c[v.variantId]?.qty ?? 0) + n },
    }));
    setDone(null);
    setCartOpen(true);
  }
  function setLineQty(variantId: string, q: number) {
    setCart((c) => {
      if (q <= 0) { const { [variantId]: _d, ...rest } = c; return rest; }
      return { ...c, [variantId]: { ...c[variantId]!, qty: q } };
    });
  }

  // ── Quote del servidor (al entrar al checkout y al cambiar entrega/pago) ──────
  const fetchQuote = useCallback(async () => {
    if (items.length === 0) { setQuote(null); return; }
    try {
      const res = await fetch(`/api/checkout/quote?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: items.map(([variantId, l]) => ({ variantId, qty: l.qty })), delivery, payment }),
      });
      const d = await res.json();
      if (res.ok) setQuote(d); else setError(d.error ?? "error");
    } catch (e) { setError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, delivery, payment, JSON.stringify(cart)]);

  useEffect(() => { if (view === "checkout") void fetchQuote(); }, [view, fetchQuote]);

  async function confirmOrder() {
    if (!form.street.trim()) { setError("Ingresá la calle y número de entrega."); return; }
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/checkout?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          items: items.map(([variantId, l]) => ({ variantId, qty: l.qty })),
          address: { street: form.street, zone: form.zone, phone: form.phone, notes: form.notes },
          delivery,
          payment,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "error en el checkout"); return; }
      // Mostramos el total cotizado (con descuento) que el cliente confirmó.
      const shownTotal = quote?.totalMinor ?? d.totalMinor;
      setDone({ orderId: d.orderId, totalMinor: shownTotal });
      setCart({});
      go("done");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  // ── Sub-render por vista ─────────────────────────────────────────────────────
  const sel = products.find((p) => p.productId === selId) ?? products[0] ?? null;

  return (
    <div style={{ fontFamily: FONT, color: C.text, background: C.white, minHeight: "100vh" }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" />
      <style>{`
        .sf-card{transition:box-shadow .18s ease;}
        .sf-card:hover{box-shadow:0 10px 30px rgba(0,0,0,.07);}
        .sf-btn{transition:background .18s ease, filter .15s ease;}
        .sf-btn:active{transform:translateY(1px);}
        .sf-a{cursor:pointer;}
        *{box-sizing:border-box;}
      `}</style>

      {/* Barra promocional */}
      {props.content.promoText && (
        <div style={{ background: G, color: C.white, fontSize: 13, padding: "9px 24px", textAlign: "center", letterSpacing: ".01em" }}>
          {props.content.promoText}
        </div>
      )}

      <Header
        G={G} tenant={tenant} logoUrl={props.logoUrl} displayName={props.displayName}
        categories={categories} activeCat={view === "list" ? category : ""} query={query}
        cartCount={items.reduce((a, [, l]) => a + l.qty, 0)} subtotal={subtotal}
        showPets={config.foodCalculator} factors={config.nutritionFactors}
        adoptionsLabel={props.adoptions.length > 0 ? props.adoptionsTitle : ""} adoptionsActive={view === "adopciones"}
        comparatorLabel={config.foodComparator && foodProducts.length >= 2 ? "Comparar alimentos" : ""} comparatorActive={view === "comparar"}
        onHome={() => { setQuery(""); setCategory(""); go("home"); }}
        onCategory={(c) => { setCategory(c); setQuery(""); go("list"); }}
        onSearch={(q) => { setQuery(q); if (q) { setCategory(""); go("list"); } else go("home"); }}
        onAdoptions={() => go("adopciones")}
        onComparar={() => go("comparar")}
        onCart={() => setCartOpen(true)}
        waLink={waLink()}
      />

      <main style={{ maxWidth: view === "checkout" ? 1000 : view === "done" ? 620 : 1180, margin: "0 auto", padding: view === "done" ? "90px 24px 120px" : "28px 24px 80px" }}>
        {view === "home" && (
          <HomeView
            G={G} products={products} categories={categories} config={config} threshold={threshold} content={props.content}
            waLink={waLink("¡Hola! Quiero hacer un pedido.")}
            onSeeList={() => { setCategory(""); setQuery(""); go("list"); }}
            onCategory={(c) => { setCategory(c); setQuery(""); go("list"); }}
            onOpen={(p) => { setSelId(p.productId); setSizeVariant(null); setQty(1); go("detail"); }}
            onAdd={(p) => addToCart(p, defaultVariant(p).variantId, 1)}
          />
        )}

        {view === "list" && (
          <ListView
            G={G} products={products} categories={categories} category={category} query={query}
            sort={sort} columns={config.listColumns} setSort={setSort} setCategory={(c) => setCategory(c)}
            onOpen={(p) => { setSelId(p.productId); setSizeVariant(null); setQty(1); go("detail"); }}
            onAdd={(p) => addToCart(p, defaultVariant(p).variantId, 1)}
          />
        )}

        {view === "detail" && sel && (
          <DetailView
            G={G} p={sel} category={sel.category}
            sizeVariant={sizeVariant ?? defaultVariant(sel).variantId} setSizeVariant={setSizeVariant}
            qty={qty} setQty={setQty}
            showCalculator={config.foodCalculator} factors={config.nutritionFactors}
            waLink={waLink(`¡Hola! Quiero consultar por ${sel.name}.`)}
            onBackCat={() => { setCategory(sel.category); go("list"); }}
            onAdd={(variantId) => addToCart(sel, variantId, qty)}
          />
        )}

        {view === "checkout" && (
          <CheckoutView
            G={G} items={items} config={config} quote={quote}
            delivery={delivery} setDelivery={setDelivery} payment={payment} setPayment={setPayment}
            form={form} setForm={setForm} busy={busy} error={error}
            subtotal={subtotal} shippingFor={shippingFor} discountFor={discountFor}
            onConfirm={confirmOrder}
          />
        )}

        {view === "done" && done && (
          <DoneView G={G} orderId={done.orderId} totalMinor={done.totalMinor} onHome={() => { setCategory(""); setQuery(""); go("home"); }} />
        )}

        {view === "adopciones" && (
          <AdoptionsView G={G} title={props.adoptionsTitle} adoptions={props.adoptions} storeWhatsapp={props.whatsapp} />
        )}

        {view === "comparar" && (
          <ComparatorView G={G} foods={foodProducts} factors={config.nutritionFactors} onOpen={(p) => { setSelId(p.productId); setSizeVariant(null); setQty(1); go("detail"); }} />
        )}
      </main>

      <Footer G={G} displayName={props.displayName} blurb={props.content.footerBlurb} categories={categories} onCategory={(c) => { setCategory(c); setQuery(""); go("list"); }} onHome={() => go("home")} />

      {/* Drawer de carrito */}
      {cartOpen && (
        <CartDrawer
          G={G} items={items} subtotal={subtotal} shipping={shippingFor("estandar")} freeShipMsg={freeShipMsg}
          onClose={() => setCartOpen(false)} onQty={setLineQty}
          onCheckout={() => { if (items.length > 0) { setCartOpen(false); setError(null); go("checkout"); } }}
        />
      )}

      {/* Botón flotante de WhatsApp */}
      {waLink() && (
        <div style={{ position: "fixed", right: 26, bottom: 26, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <a href={waLink()!} target="_blank" rel="noopener noreferrer" aria-label="Escribinos por WhatsApp"
            style={{ width: 58, height: 58, borderRadius: "50%", background: C.wa, boxShadow: "0 8px 24px rgba(37,211,102,.4)", display: "grid", placeItems: "center", color: C.white }}>
            <WaIcon size={30} />
          </a>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: C.text2, background: C.white, borderRadius: 7, padding: "4px 7px", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>Escribinos por WhatsApp</span>
        </div>
      )}
    </div>
  );
}

// ── Iconos SVG inline ──────────────────────────────────────────────────────────
function WaIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 4C9.9 4 5 8.9 5 15c0 1.9.5 3.7 1.4 5.3L5 28l7.9-1.4c1.5.8 3.2 1.2 5 1.2h.1C24.1 27.8 29 22.9 29 16.8 29 10.7 24.1 4 16 4z" fill="currentColor" stroke="none" opacity="0" />
      <path d="M16 4.5C10.2 4.5 5.5 9.2 5.5 15c0 1.9.5 3.6 1.4 5.2l-1 3.6 3.7-1c1.5.8 3.2 1.3 5 1.3 5.8 0 10.5-4.7 10.5-10.5S21.8 4.5 16 4.5z" />
      <path d="M12.3 10.4c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-.9.9-.9 2.1s.9 2.5 1.1 2.6c.1.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3s-1.5-.7-1.7-.8c-.2-.1-.4-.1-.6.1-.2.3-.6.8-.8 1-.1.1-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.5-1.8-.1-.3 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.3 0-.5 0-.1-.6-1.5-.8-2z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CartIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" />
      <path d="M2 3h2.2l2 12.5h11l2-9H6.3" />
    </svg>
  );
}
function Check({ size = 16, sw = 2.4 }: { size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

// ── Placeholder de imagen (foto real cuando exista) ─────────────────────────────
function Img({ src, alt, ratio, radius, label, hero }: { src?: string; alt: string; ratio?: string; radius: React.CSSProperties["borderRadius"]; label: string; hero?: boolean }) {
  const base: React.CSSProperties = { width: "100%", borderRadius: radius, objectFit: "cover", display: "block", ...(ratio ? { aspectRatio: ratio } : {}), ...(hero ? { height: 340 } : {}) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="sf-img" src={src} alt={alt} style={base} />;
  }
  return (
    <div style={{ ...base, background: PH_BG, display: "grid", placeItems: "center", ...(ratio ? {} : hero ? { height: 340 } : { height: 180 }) }}>
      <span style={{ fontFamily: "monospace", fontSize: 12, color: C.ph }}>{label}</span>
    </div>
  );
}

// ── Botones reutilizables ────────────────────────────────────────────────────────
function primaryBtn(G: string): React.CSSProperties {
  return { background: G, color: C.white, border: "none", borderRadius: 10, padding: "14px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9, justifyContent: "center", fontFamily: FONT };
}
function outlineBtn(G: string): React.CSSProperties {
  return { background: C.white, color: G, border: `1.5px solid ${G}`, borderRadius: 10, padding: "14px 26px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9, justifyContent: "center", fontFamily: FONT };
}
const input: React.CSSProperties = { padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 9, fontSize: 14, outline: "none", width: "100%", fontFamily: FONT, background: C.white, color: C.text };

// ── Header ───────────────────────────────────────────────────────────────────────
function Header(props: {
  G: string; tenant: string; logoUrl: string; displayName: string;
  categories: { name: string; count: number }[]; activeCat: string; query: string;
  cartCount: number; subtotal: number;
  showPets: boolean; factors: Record<string, number>;
  adoptionsLabel: string; adoptionsActive: boolean;
  comparatorLabel: string; comparatorActive: boolean;
  onHome: () => void; onCategory: (c: string) => void; onSearch: (q: string) => void; onAdoptions: () => void; onComparar: () => void; onCart: () => void; waLink: string | null;
}) {
  const { G } = props;
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 40, background: C.white, borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", gap: 32, alignItems: "center" }}>
      {/* Logo */}
      <div className="sf-a" onClick={props.onHome} style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {props.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.logoUrl} alt={props.displayName} style={{ height: 44, width: "auto", maxWidth: 180, objectFit: "contain", display: "block" }} />
        ) : (
          <>
            <span style={{ width: 42, height: 42, borderRadius: "50%", border: `2px solid ${G}`, display: "grid", placeItems: "center", flexShrink: 0 }}><span style={{ width: 16, height: 16, borderRadius: "50%", background: G, display: "block" }} /></span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              <span style={{ fontSize: 19, fontWeight: 700, color: G, letterSpacing: ".02em" }}>{props.displayName.replace(/gualeguay/i, "").trim().toUpperCase() || "PET SHOP"}</span>
              <span style={{ fontSize: 9, fontWeight: 500, color: C.mute, letterSpacing: ".34em", marginTop: 3 }}>{/gualeguay/i.test(props.displayName) ? "GUALEGUAY" : ""}</span>
            </span>
          </>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", gap: 26, fontSize: 14, flexWrap: "wrap" }}>
        <NavItem label="Inicio" active={props.activeCat === "" && !props.query} onClick={props.onHome} G={G} />
        {props.categories.map((c) => (
          <NavItem key={c.name} label={c.name} active={props.activeCat === c.name} onClick={() => props.onCategory(c.name)} G={G} />
        ))}
        {props.comparatorLabel && <NavItem label={props.comparatorLabel} active={props.comparatorActive} onClick={props.onComparar} G={G} />}
        {props.adoptionsLabel && <NavItem label={props.adoptionsLabel} active={props.adoptionsActive} onClick={props.onAdoptions} G={G} />}
        {props.waLink && <a href={props.waLink} target="_blank" rel="noopener noreferrer" style={{ color: C.nav, fontWeight: 500, textDecoration: "none", borderBottom: "2px solid transparent", paddingBottom: 3 }}>Contacto</a>}
      </nav>

      {/* Derecha */}
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 999, padding: "7px 14px" }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.mute} strokeWidth={2} aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input value={props.query} onChange={(e) => props.onSearch(e.target.value)} placeholder="Buscar productos" style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, width: 150, fontFamily: FONT, color: C.text }} />
        </div>
        <AccountMenu G={G} tenant={props.tenant} showPets={props.showPets} factors={props.factors} />
        <button className="sf-btn" onClick={props.onCart} style={{ background: G, color: C.white, border: "none", borderRadius: 999, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 9, cursor: "pointer", fontFamily: FONT }}>
          <CartIcon size={18} /><span style={{ fontSize: 14, fontWeight: 600 }}>{money(props.subtotal)}</span>
        </button>
      </div>
    </header>
  );
}
function NavItem({ label, active, onClick, G }: { label: string; active: boolean; onClick: () => void; G: string }) {
  return (
    <span className="sf-a" onClick={onClick} style={{ fontWeight: active ? 600 : 500, color: active ? G : C.nav, borderBottom: `2px solid ${active ? G : "transparent"}`, paddingBottom: 3 }}>{label}</span>
  );
}

// ── Product card ─────────────────────────────────────────────────────────────────
function ProductCard({ G, p, listRow, onOpen, onAdd }: { G: string; p: StoreProduct; listRow?: boolean; onOpen: () => void; onAdd: () => void }) {
  const price = Number(p.variants[p.variants.length - 1]!.priceMinor);
  const sub = p.variants[p.variants.length - 1]!.size;
  return (
    <div className="sf-card" style={{ border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, background: C.white, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="sf-a" onClick={onOpen}><Img src={p.imageUrl} alt={p.name} ratio="1" radius={12} label="512 × 512" /></div>
      <div className="sf-a" onClick={onOpen} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: listRow ? 15 : 14.5, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</span>
        <span style={{ fontSize: 12, color: C.mute }}>{sub}{p.category ? ` · ${p.category}` : ""}</span>
      </div>
      {listRow ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: G }}>{money(price)}</span>
          <button className="sf-btn" onClick={onAdd} style={{ background: G, color: C.white, border: "none", borderRadius: 9, padding: "10px 15px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: FONT }}><CartIcon size={15} />AGREGAR</button>
        </div>
      ) : (
        <>
          <span style={{ fontSize: 21, fontWeight: 700, color: G, marginTop: "auto" }}>{money(price)}</span>
          <button className="sf-btn" onClick={onAdd} style={{ background: G, color: C.white, border: "none", borderRadius: 9, padding: 11, fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: FONT }}><CartIcon size={15} />AGREGAR</button>
        </>
      )}
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────────
function SectionHead({ G, title, action, onAction }: { G: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 56, marginBottom: 22 }}>
      <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.01em", borderBottom: `3px solid ${G}`, paddingBottom: 8 }}>{title}</h2>
      {action && <span className="sf-a" onClick={onAction} style={{ fontSize: 13.5, fontWeight: 600, color: G }}>{action}</span>}
    </div>
  );
}

function HomeView(props: {
  G: string; products: StoreProduct[]; categories: { name: string; count: number }[]; config: StoreConfig; threshold: number; content: StoreContent;
  waLink: string | null; onSeeList: () => void; onCategory: (c: string) => void; onOpen: (p: StoreProduct) => void; onAdd: (p: StoreProduct) => void;
}) {
  const { G, content } = props;
  const perks = content.perks;
  const benefits = content.benefits;
  const featured = props.products.slice(0, props.config.featuredCount);
  return (
    <>
      {/* Hero */}
      <section style={{ background: C.beige, borderRadius: 20, padding: "52px 0 52px 52px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "center", overflow: "hidden" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 46, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-.02em", maxWidth: 460 }}>
            {content.heroTitle} {content.heroHighlight && <span style={{ color: G }}>{content.heroHighlight}</span>}
          </h1>
          {content.heroSubtitle && <p style={{ fontSize: 16, color: C.text2, lineHeight: 1.6, marginTop: 18, maxWidth: 460 }}>{content.heroSubtitle}</p>}
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            {props.waLink && <a className="sf-btn" href={props.waLink} target="_blank" rel="noopener noreferrer" style={{ ...primaryBtn(G), textDecoration: "none" }}><WaIcon size={17} />HACÉ TU PEDIDO POR WHATSAPP</a>}
            <button className="sf-btn" onClick={props.onSeeList} style={outlineBtn(G)}>VER PRODUCTOS</button>
          </div>
          {perks.length > 0 && (
            <div style={{ display: "flex", gap: 30, marginTop: 34, flexWrap: "wrap" }}>
              {perks.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: G, marginTop: 1 }}><Check size={16} /></span>
                  <span style={{ display: "flex", flexDirection: "column", fontSize: 12.5 }}>
                    <span style={{ color: C.nav, fontWeight: 600 }}>{p.t}</span>
                    <span style={{ color: C.mute }}>{p.s}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <Img alt="banner principal" radius="16px 0 0 16px" label="banner principal 1080 × 450" hero />
          <div style={{ position: "absolute", left: -46, top: "50%", transform: "translateY(-50%)", width: 132, height: 132, borderRadius: "50%", background: G, color: C.white, boxShadow: "0 8px 24px rgba(46,125,50,.28)", display: "grid", placeItems: "center", textAlign: "center", padding: 10 }}>
            <span><span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>Envíos GRATIS</span><span style={{ display: "block", fontSize: 9.5, opacity: .9 }}>en compras superiores a {money(props.threshold)}</span></span>
          </div>
        </div>
      </section>

      {/* Franja de beneficios */}
      {benefits.length > 0 && (
        <div style={{ marginTop: 18, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 24px", display: "grid", gridTemplateColumns: `repeat(${Math.min(5, benefits.length)},1fr)`, gap: 20 }}>
          {benefits.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: C.iconBg, color: G, display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>★</span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{b.t}</span>
                <span style={{ fontSize: 11.5, color: C.mute }}>{b.s}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Categorías */}
      {props.categories.length > 0 && (
        <>
          <SectionHead G={G} title="Categorías" action="Ver todas →" onAction={props.onSeeList} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16 }}>
            {props.categories.slice(0, 10).map((c) => (
              <div key={c.name} className="sf-a" onClick={() => props.onCategory(c.name)} style={{ textAlign: "center" }}>
                <div style={{ aspectRatio: "1", borderRadius: 16, background: PH_BG, display: "grid", placeItems: "center" }}><span style={{ fontFamily: "monospace", fontSize: 11, color: C.ph }}>512 × 512</span></div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 10 }}>{c.name}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Destacados */}
      <SectionHead G={G} title="Productos destacados" action="Ver todos →" onAction={props.onSeeList} />
      {featured.length === 0 ? <p style={{ color: C.mute }}>Todavía no hay productos cargados.</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
          {featured.map((p) => <ProductCard key={p.productId} G={G} p={p} onOpen={() => props.onOpen(p)} onAdd={() => props.onAdd(p)} />)}
        </div>
      )}
    </>
  );
}

// ── Listado ────────────────────────────────────────────────────────────────────
function ListView(props: {
  G: string; products: StoreProduct[]; categories: { name: string; count: number }[]; category: string; query: string;
  sort: "relevancia" | "menor" | "mayor"; columns: 2 | 3 | 4; setSort: (s: "relevancia" | "menor" | "mayor") => void; setCategory: (c: string) => void;
  onOpen: (p: StoreProduct) => void; onAdd: (p: StoreProduct) => void;
}) {
  const { G } = props;
  const q = props.query.trim().toLowerCase();
  let list = props.products.filter((p) => (q ? `${p.name} ${p.category}`.toLowerCase().includes(q) : props.category ? p.category === props.category : true));
  const priceOf = (p: StoreProduct) => Number(p.variants[p.variants.length - 1]!.priceMinor);
  if (props.sort === "menor") list = [...list].sort((a, b) => priceOf(a) - priceOf(b));
  if (props.sort === "mayor") list = [...list].sort((a, b) => priceOf(b) - priceOf(a));

  const title = q ? `Resultados para "${props.query}"` : props.category || "Todos los productos";
  return (
    <>
      <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 14 }}>Inicio / {q ? "Búsqueda" : props.category || "Productos"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</h1>
        <span style={{ fontSize: 13, color: C.mute }}>{list.length} productos</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 28, alignItems: "start", marginTop: 20 }}>
        {/* Sidebar */}
        <aside style={{ border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.mute, letterSpacing: ".06em", marginBottom: 12 }}>CATEGORÍAS</div>
          {props.categories.map((c) => {
            const on = !q && props.category === c.name;
            return (
              <div key={c.name} className="sf-a" onClick={() => props.setCategory(c.name)} style={{ display: "flex", justifyContent: "space-between", padding: "9px 11px", borderRadius: 9, fontSize: 13.5, background: on ? C.tint : "transparent", color: on ? G : C.text, fontWeight: on ? 600 : 400 }}>
                <span>{c.name}</span><span style={{ fontSize: 11.5, opacity: .7 }}>{c.count}</span>
              </div>
            );
          })}
          <div style={{ height: 1, background: C.border, margin: "16px 0" }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: C.mute, letterSpacing: ".06em", marginBottom: 10 }}>ORDENAR POR</div>
          {([["relevancia", "Relevancia"], ["menor", "Menor precio"], ["mayor", "Mayor precio"]] as const).map(([k, label]) => (
            <div key={k} className="sf-a" onClick={() => props.setSort(k)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", fontSize: 13.5 }}>
              <span style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${props.sort === k ? G : C.radioOff}`, display: "grid", placeItems: "center" }}>{props.sort === k && <span style={{ width: 7, height: 7, borderRadius: "50%", background: G }} />}</span>
              {label}
            </div>
          ))}
        </aside>

        {/* Grid */}
        {list.length === 0 ? <p style={{ color: C.mute }}>No hay productos en esta categoría.</p> : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${props.columns},1fr)`, gap: 18 }}>
            {list.map((p) => <ProductCard key={p.productId} G={G} p={p} listRow onOpen={() => props.onOpen(p)} onAdd={() => props.onAdd(p)} />)}
          </div>
        )}
      </div>
    </>
  );
}

// ── Detalle ─────────────────────────────────────────────────────────────────────
function DetailView(props: {
  G: string; p: StoreProduct; category: string; sizeVariant: string; setSizeVariant: (v: string) => void;
  qty: number; setQty: (n: number) => void; showCalculator: boolean; factors: Record<string, number>;
  waLink: string | null; onBackCat: () => void; onAdd: (variantId: string) => void;
}) {
  const { G, p } = props;
  const variant = p.variants.find((v) => v.variantId === props.sizeVariant) ?? p.variants[p.variants.length - 1]!;
  const isFood = !!(p.kcalPerKg && p.kcalPerKg > 0);
  return (
    <>
      <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 14 }}>
        Inicio / <span className="sf-a" onClick={props.onBackCat}>{p.category || "Productos"}</span> / {p.name}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
        <Img src={p.imageUrl} alt={p.name} ratio="1" radius={20} label="foto producto 1080 × 1080" />
        <div>
          {p.category && <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", color: C.lightGreen }}>{p.category.toUpperCase()}</div>}
          <h1 style={{ margin: "6px 0 0", fontSize: 34, fontWeight: 700, letterSpacing: "-.02em" }}>{p.name}</h1>
          <div style={{ fontSize: 14.5, color: C.mute, marginTop: 4 }}>{variant.size}</div>
          <div style={{ fontSize: 38, fontWeight: 700, color: G, marginTop: 22 }}>{money(variant.priceMinor)}</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.lightGreen, marginTop: 2 }}>En stock</div>
          {isFood && (
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 12.5, color: C.text2 }}>
              {p.proteinPct ? <span>🥩 Proteína <b>{p.proteinPct}%</b></span> : null}
              {p.kcalPerKg ? <span>⚡ <b>{p.kcalPerKg}</b> kcal/kg</span> : null}
            </div>
          )}
          {p.description && <p style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.65, maxWidth: 460, marginTop: 14 }}>{p.description}</p>}

          {p.variants.length > 1 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.mute, letterSpacing: ".06em", marginTop: 28, marginBottom: 10 }}>PESO / PRESENTACIÓN</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {p.variants.map((v) => {
                  const on = v.variantId === variant.variantId;
                  return (
                    <button key={v.variantId} onClick={() => props.setSizeVariant(v.variantId)} style={{ padding: "11px 20px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, border: `1.5px solid ${on ? G : C.border}`, background: on ? C.tint : C.white, color: on ? G : C.nav, cursor: "pointer", fontFamily: FONT }}>{v.size}</button>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ fontSize: 13, fontWeight: 600, color: C.mute, letterSpacing: ".06em", marginTop: 24, marginBottom: 10 }}>CANTIDAD</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 16, border: `1.5px solid ${C.border}`, borderRadius: 9, padding: "6px 10px" }}>
            <button onClick={() => props.setQty(Math.max(1, props.qty - 1))} style={{ width: 28, height: 28, border: "none", background: "transparent", fontSize: 20, color: C.nav, cursor: "pointer" }}>−</button>
            <span style={{ fontSize: 15, fontWeight: 600, minWidth: 16, textAlign: "center" }}>{props.qty}</span>
            <button onClick={() => props.setQty(props.qty + 1)} style={{ width: 28, height: 28, border: "none", background: "transparent", fontSize: 18, color: C.nav, cursor: "pointer" }}>+</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420, marginTop: 28 }}>
            <button className="sf-btn" onClick={() => props.onAdd(variant.variantId)} style={{ ...primaryBtn(G), padding: 15 }}><CartIcon size={17} />AGREGAR AL CARRITO</button>
            {props.waLink && <a className="sf-btn" href={props.waLink} target="_blank" rel="noopener noreferrer" style={{ ...outlineBtn(G), padding: 15 }}><WaIcon size={17} />COMPRAR POR WHATSAPP</a>}
          </div>

          {props.showCalculator && isFood && <FoodCalculator G={G} kcalPerKg={p.kcalPerKg!} netWeightKg={variant.netWeightKg} factors={props.factors} />}
        </div>
      </div>
    </>
  );
}

// ── Checkout ────────────────────────────────────────────────────────────────────
function RadioCard({ G, on, title, sub, price, onClick }: { G: string; on: boolean; title: string; sub: string; price?: string; onClick: () => void }) {
  return (
    <div className="sf-a" onClick={onClick} style={{ display: "flex", gap: 13, alignItems: "center", padding: 14, borderRadius: 11, border: `1.5px solid ${on ? G : C.border}`, background: on ? C.tint : C.white, marginBottom: 10 }}>
      <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${on ? G : C.radioOff}`, display: "grid", placeItems: "center", flexShrink: 0 }}>{on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: G }} />}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: C.mute }}>{sub}</span>
      </span>
      {price && <span style={{ fontSize: 13.5, fontWeight: 600, color: G }}>{price}</span>}
    </div>
  );
}

function CheckoutView(props: {
  G: string; items: [string, CartLine][]; config: StoreConfig; quote: Quote | null;
  delivery: "estandar" | "auxilio"; setDelivery: (d: "estandar" | "auxilio") => void;
  payment: "transferencia" | "mercadopago" | "efectivo"; setPayment: (p: "transferencia" | "mercadopago" | "efectivo") => void;
  form: { street: string; zone: string; phone: string; notes: string }; setForm: (f: { street: string; zone: string; phone: string; notes: string }) => void;
  busy: boolean; error: string | null; subtotal: number; shippingFor: (d: "estandar" | "auxilio") => number; discountFor: (p: string) => number; onConfirm: () => void;
}) {
  const { G, form, setForm } = props;
  // Números autoritativos: quote del server; fallback a cálculo local mientras carga.
  const sub = props.quote ? Number(props.quote.gmvMinor) : props.subtotal;
  const ship = props.quote ? Number(props.quote.deliveryChargeMinor) : props.shippingFor(props.delivery);
  const disc = props.quote ? Number(props.quote.discountMinor) : props.discountFor(props.payment);
  const total = props.quote ? Number(props.quote.totalMinor) : sub + ship - disc;
  const card: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 };
  return (
    <>
      <h1 style={{ margin: "0 0 26px", fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>Finalizar compra</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 28, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Dirección de envío</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Calle y número" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
              <input style={input} placeholder="Barrio / zona" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
              <input style={input} placeholder="Teléfono / WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Notas (timbre, referencia…)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Método de entrega</div>
            <RadioCard G={G} on={props.delivery === "estandar"} title="Envío estándar" sub="En el día (13:00 a 20:00)" price={sub >= Number(props.config.freeShippingThresholdMinor) ? "Gratis" : money(props.config.standardCostMinor)} onClick={() => props.setDelivery("estandar")} />
            {props.config.auxilioEnabled && (
              <RadioCard G={G} on={props.delivery === "auxilio"} title="Envío de Auxilio" sub="Hoy de 20:00 a 23:00 hs" price={money(props.config.auxilioCostMinor)} onClick={() => props.setDelivery("auxilio")} />
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Método de pago</div>
            <RadioCard G={G} on={props.payment === "transferencia"} title="Transferencia bancaria" sub={`${props.config.transferDiscountPercent}% de descuento`} onClick={() => props.setPayment("transferencia")} />
            <RadioCard G={G} on={props.payment === "mercadopago"} title="Mercado Pago" sub="Débito, crédito o dinero en cuenta" onClick={() => props.setPayment("mercadopago")} />
            <RadioCard G={G} on={props.payment === "efectivo"} title="Efectivo" sub="Pagás al recibir el pedido" onClick={() => props.setPayment("efectivo")} />
          </div>
        </div>

        {/* Resumen */}
        <div style={{ position: "sticky", top: 96, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Resumen</div>
          {props.items.map(([id, l]) => (
            <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: C.text2, padding: "4px 0" }}>
              <span>{l.qty}× {l.name}</span><span style={{ fontWeight: 600, color: C.text }}>{money(l.priceMinor * l.qty)}</span>
            </div>
          ))}
          <div style={{ height: 1, background: C.borderBeige, margin: "14px 0" }} />
          <Row label="Subtotal" value={money(sub)} />
          <Row label="Envío" value={ship === 0 ? "Gratis" : money(ship)} />
          {disc > 0 && <Row label={`Descuento transferencia (${props.config.transferDiscountPercent}%)`} value={`−${money(disc)}`} valueColor={G} />}
          <div style={{ height: 1, background: C.borderBeige, margin: "14px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span><span style={{ fontSize: 26, fontWeight: 700, color: G }}>{money(total)}</span>
          </div>
          {props.error && <p style={{ color: "#c62828", fontSize: 12.5, margin: "10px 0 0" }}>{props.error}</p>}
          <button className="sf-btn" onClick={props.onConfirm} disabled={props.busy} style={{ ...primaryBtn(G), width: "100%", padding: 15, marginTop: 18 }}>{props.busy ? "Procesando…" : "CONFIRMAR PEDIDO"}</button>
          <p style={{ fontSize: 11.5, color: C.mute, textAlign: "center", marginTop: 10, marginBottom: 0 }}>Te confirmamos el pedido por WhatsApp antes de salir a entregar.</p>
        </div>
      </div>
    </>
  );
}
function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: C.text2, padding: "3px 0" }}>
      <span>{label}</span><span style={{ fontWeight: 600, color: valueColor ?? C.text }}>{value}</span>
    </div>
  );
}

// ── Confirmación ─────────────────────────────────────────────────────────────────
function DoneView({ G, orderId, totalMinor, onHome }: { G: string; orderId: string; totalMinor: string; onHome: () => void }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 74, height: 74, borderRadius: "50%", background: C.iconBg, color: G, display: "grid", placeItems: "center", margin: "0 auto" }}><Check size={34} sw={2.6} /></div>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 24 }}>¡Pedido confirmado!</h1>
      <p style={{ fontSize: 15.5, color: C.text2, lineHeight: 1.65 }}>Pedido <b>#{orderId.slice(0, 8)}</b> por <b>{money(totalMinor)}</b>. Te escribimos por WhatsApp para coordinar la entrega en Gualeguay.</p>
      <button className="sf-btn" onClick={onHome} style={{ ...primaryBtn(G), padding: "14px 30px", marginTop: 28 }}>SEGUIR COMPRANDO</button>
    </div>
  );
}

// ── Drawer de carrito ─────────────────────────────────────────────────────────────
function CartDrawer(props: {
  G: string; items: [string, CartLine][]; subtotal: number; shipping: number; freeShipMsg: string;
  onClose: () => void; onQty: (variantId: string, q: number) => void; onCheckout: () => void;
}) {
  const { G } = props;
  const total = props.subtotal + props.shipping;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div onClick={props.onClose} style={{ position: "absolute", inset: 0, background: "rgba(34,34,34,.42)" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 420, maxWidth: "92vw", background: C.white, boxShadow: "-8px 0 40px rgba(0,0,0,.16)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Mi carrito</span>
          <button onClick={props.onClose} aria-label="Cerrar" style={{ border: "none", background: "transparent", fontSize: 22, color: C.mute, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {props.items.length === 0 ? (
            <div style={{ textAlign: "center", fontSize: 14, color: C.mute, padding: "60px 0" }}>Tu carrito está vacío.<br />Agregá productos para empezar.</div>
          ) : props.items.map(([id, l]) => (
            <div key={id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.borderCart}` }}>
              <div style={{ width: 66, height: 66, borderRadius: 10, background: PH_BG, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: C.mute }}>{l.sub}</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10, border: `1px solid ${C.border}`, borderRadius: 8, padding: "3px 9px", marginTop: 6 }}>
                  <button onClick={() => props.onQty(id, l.qty - 1)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 15 }}>−</button>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{l.qty}</span>
                  <button onClick={() => props.onQty(id, l.qty + 1)} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 15 }}>+</button>
                </div>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{money(l.priceMinor * l.qty)}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: "20px 24px", borderTop: `1px solid ${C.border}`, background: C.surf }}>
          <Row label="Subtotal" value={money(props.subtotal)} />
          <Row label="Envío" value={props.shipping === 0 ? "Gratis" : money(props.shipping)} />
          {props.freeShipMsg && <div style={{ fontSize: 12, fontWeight: 600, color: G, marginTop: 6 }}>{props.freeShipMsg}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Total</span><span style={{ fontSize: 24, fontWeight: 700, color: G }}>{money(total)}</span>
          </div>
          <button className="sf-btn" onClick={props.onCheckout} disabled={props.items.length === 0} style={{ ...primaryBtn(G), width: "100%", marginTop: 14 }}>FINALIZAR COMPRA</button>
        </div>
      </div>
    </div>
  );
}

// ── Comparador de alimentos (costo por día / conveniencia) ────────────────────────
function ComparatorView({ G, foods, factors, onOpen }: { G: string; foods: StoreProduct[]; factors: Record<string, number>; onOpen: (p: StoreProduct) => void }) {
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState("adulto_normal");
  const [pets, setPets] = useState<CalcPet[]>([]);

  useEffect(() => { fetch("/api/account/pets").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.pets) setPets(d.pets); }).catch(() => {}); }, []);

  const w = Number(weight);
  const factor = factors[activity] ?? DEFAULT_FACTORS[activity] ?? 1.4;

  // Para cada alimento: elegimos la bolsa más grande con peso (mejor $/kg) y calculamos.
  const rows = foods.map((p) => {
    const withKg = p.variants.filter((v) => v.netWeightKg && v.netWeightKg > 0);
    const v = withKg.reduce((a, b) => (b.netWeightKg! > (a?.netWeightKg ?? 0) ? b : a), withKg[0]!);
    const pricePesos = Number(v.priceMinor) / 100;
    const c = w > 0 ? consumption(w, factor, p.kcalPerKg!) : null;
    const costPerDay = c && c.gramsPerDay > 0 ? (c.gramsPerDay / 1000) * (pricePesos / v.netWeightKg!) : 0;
    const days = c && c.gramsPerDay > 0 ? Math.floor((v.netWeightKg! * 1000) / c.gramsPerDay) : 0;
    return { p, v, pricePesos, protein: p.proteinPct, gramsPerDay: c?.gramsPerDay ?? 0, costPerDay, costPerMonth: costPerDay * 30, days };
  }).filter((r) => r.costPerDay > 0).sort((a, b) => a.costPerDay - b.costPerDay);

  const cheapest = rows[0]?.costPerDay ?? 0;
  const bestQuality = rows.reduce((a, b) => ((b.protein ?? 0) > (a?.protein ?? 0) ? b : a), rows[0]);

  return (
    <>
      <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 14 }}>Inicio / Comparar alimentos</div>
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>Comparar alimentos</h1>
      <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.6, marginTop: 6, maxWidth: 680 }}>
        El precio por kilo engaña: un alimento más concentrado rinde más y tu mascota come menos. Compará por <b>costo por día</b> — muchas veces el premium sale más barato.
      </p>

      <div style={{ marginTop: 16, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: C.surf }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.mute, marginBottom: 8 }}>Datos de tu mascota</div>
        {pets.length > 0 && (
          <select onChange={(e) => { const p = pets.find((x) => x.id === e.target.value); if (p) { if (p.weightKg) setWeight(String(p.weightKg)); setActivity(p.activity); } }} defaultValue="" style={{ ...input, marginBottom: 8 }}>
            <option value="" disabled>Usar una de mis mascotas…</option>
            {pets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.weightKg ? ` (${p.weightKg} kg)` : ""}</option>)}
          </select>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Peso (kg)" inputMode="decimal" style={{ ...input, width: 120 }} />
          <select value={activity} onChange={(e) => setActivity(e.target.value)} style={{ ...input, flex: 1, minWidth: 180 }}>
            {Object.keys({ ...DEFAULT_FACTORS, ...factors }).map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k] ?? k}</option>)}
          </select>
        </div>
      </div>

      {w > 0 ? (
        <div style={{ overflowX: "auto", marginTop: 18 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 620 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.mute, fontSize: 12.5 }}>
                <th style={{ padding: "8px 10px" }}>Alimento</th>
                <th style={{ padding: "8px 10px" }}>Proteína</th>
                <th style={{ padding: "8px 10px" }}>Come/día</th>
                <th style={{ padding: "8px 10px" }}>Bolsa</th>
                <th style={{ padding: "8px 10px", color: G }}>$/día</th>
                <th style={{ padding: "8px 10px" }}>$/mes</th>
                <th style={{ padding: "8px 10px" }}>Dura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isCheapest = r.costPerDay === cheapest;
                const isBest = bestQuality && r.p.productId === bestQuality.p.productId;
                return (
                  <tr key={r.p.productId} className="sf-a" onClick={() => onOpen(r.p)} style={{ borderTop: `1px solid ${C.border}`, background: isCheapest ? C.tint : "transparent" }}>
                    <td style={{ padding: "10px" }}>
                      <div style={{ fontWeight: 600 }}>{r.p.name}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                        {isCheapest && <span style={{ fontSize: 10.5, fontWeight: 700, color: "white", background: G, borderRadius: 999, padding: "2px 8px" }}>MÁS CONVENIENTE</span>}
                        {isBest && !isCheapest && <span style={{ fontSize: 10.5, fontWeight: 700, color: G, border: `1px solid ${G}`, borderRadius: 999, padding: "2px 8px" }}>MEJOR CALIDAD</span>}
                      </div>
                    </td>
                    <td style={{ padding: "10px" }}>{r.protein ? `${r.protein}%` : "—"}</td>
                    <td style={{ padding: "10px" }}>{r.gramsPerDay} g</td>
                    <td style={{ padding: "10px" }}>{r.v.netWeightKg} kg</td>
                    <td style={{ padding: "10px", fontWeight: 700, color: G }}>${Math.round(r.costPerDay).toLocaleString("es-AR")}</td>
                    <td style={{ padding: "10px" }}>${Math.round(r.costPerMonth).toLocaleString("es-AR")}</td>
                    <td style={{ padding: "10px" }}>{r.days} días</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 11.5, color: C.mute, marginTop: 10 }}>Estimación según el consumo de tu mascota (fórmula RER/MER) y la bolsa más conveniente de cada alimento. Ante la duda, consultá con tu veterinario.</p>
        </div>
      ) : (
        <p style={{ color: C.mute, marginTop: 18 }}>Ingresá el peso de tu mascota para ver la comparación.</p>
      )}
    </>
  );
}

// ── Calculadora de consumo (en el detalle de un alimento) ─────────────────────────
interface CalcPet { id: string; name: string; weightKg: number | null; activity: string }

function FoodCalculator({ G, kcalPerKg, netWeightKg, factors }: { G: string; kcalPerKg: number; netWeightKg: number | null; factors: Record<string, number> }) {
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState("adulto_normal");
  const [pets, setPets] = useState<CalcPet[]>([]);

  useEffect(() => {
    fetch("/api/account/pets").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.pets) setPets(d.pets); }).catch(() => {});
  }, []);

  const w = Number(weight);
  const factor = factors[activity] ?? DEFAULT_FACTORS[activity] ?? 1.4;
  const c = w > 0 ? consumption(w, factor, kcalPerKg) : null;
  const days = c && netWeightKg && netWeightKg > 0 ? Math.floor((netWeightKg * 1000) / c.gramsPerDay) : 0;

  function pickPet(id: string) {
    const p = pets.find((x) => x.id === id);
    if (p) { if (p.weightKg) setWeight(String(p.weightKg)); setActivity(p.activity); }
  }

  return (
    <div style={{ marginTop: 24, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: C.surf }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🍖 ¿Cuánto le dura?</div>
      <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 10 }}>Calculamos el consumo según el peso y la etapa de tu mascota.</div>
      {pets.length > 0 && (
        <select onChange={(e) => pickPet(e.target.value)} defaultValue="" style={{ ...input, marginBottom: 8 }}>
          <option value="" disabled>Usar una de mis mascotas…</option>
          {pets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.weightKg ? ` (${p.weightKg} kg)` : ""}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Peso (kg)" inputMode="decimal" style={{ ...input, width: 110 }} />
        <select value={activity} onChange={(e) => setActivity(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }}>
          {Object.keys({ ...DEFAULT_FACTORS, ...factors }).map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k] ?? k}</option>)}
        </select>
      </div>
      {c && (
        <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13.5 }}>
          <span><b style={{ color: G, fontSize: 18 }}>{c.gramsPerDay} g</b><br /><span style={{ color: C.mute }}>por día</span></span>
          <span><b style={{ color: G, fontSize: 18 }}>{c.kgPerMonth} kg</b><br /><span style={{ color: C.mute }}>por mes</span></span>
          {days > 0 && <span><b style={{ color: G, fontSize: 18 }}>≈ {days} días</b><br /><span style={{ color: C.mute }}>dura este paquete</span></span>}
        </div>
      )}
    </div>
  );
}

// ── Adopciones / callejeritos ────────────────────────────────────────────────────
const SPECIES_LABEL: Record<string, string> = { perro: "🐶 Perro", gato: "🐱 Gato", otro: "🐾 Mascota" };

function AdoptionsView({ G, title, adoptions, storeWhatsapp }: { G: string; title: string; adoptions: StoreAdoption[]; storeWhatsapp: string }) {
  return (
    <>
      <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 14 }}>Inicio / {title}</div>
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>{title}</h1>
      <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.6, marginTop: 6, maxWidth: 640 }}>
        Mascotas que buscan un hogar. Si te querés contactar por alguna, escribinos por WhatsApp. 💚
      </p>
      {adoptions.length === 0 ? (
        <p style={{ color: C.mute, marginTop: 24 }}>Por ahora no hay publicaciones. Volvé pronto.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 18, marginTop: 24 }}>
          {adoptions.map((a) => {
            const wa = (a.contactWhatsapp || storeWhatsapp)
              ? `https://wa.me/${a.contactWhatsapp || storeWhatsapp}?text=${encodeURIComponent(`¡Hola! Me interesa dar en adopción / adoptar a ${a.name}.`)}`
              : null;
            return (
              <div key={a.id} className="sf-card" style={{ border: `1px solid ${C.border}`, borderRadius: 16, background: C.white, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <Img src={a.imageUrl} alt={a.name} ratio="1" radius={0} label="foto mascota" />
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 17 }}>{a.name}</strong>
                    <span style={{ fontSize: 12, color: C.mute }}>{SPECIES_LABEL[a.species] ?? a.species}</span>
                  </div>
                  {a.age && <span style={{ fontSize: 12.5, color: C.mute }}>{a.age}</span>}
                  {a.description && <p style={{ fontSize: 13.5, color: C.text2, lineHeight: 1.5, margin: 0 }}>{a.description}</p>}
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="sf-btn" style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.wa, color: C.white, textDecoration: "none", borderRadius: 9, padding: "10px", fontWeight: 700, fontSize: 13 }}>
                      <WaIcon size={16} /> Consultar
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Cuenta: login/registro + Mis pedidos + Mis mascotas ──────────────────────────
function AccountMenu({ G, tenant, showPets, factors }: { G: string; tenant: string; showPets: boolean; factors: Record<string, number> }) {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "orders" | "pets">("");

  useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then((d) => setEmail(d.user?.email ?? null)).catch(() => {}); }, []);

  async function submit() {
    setErr(null);
    const res = await fetch(`/api/auth/${mode}?tenant=${encodeURIComponent(tenant)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json();
    if (!res.ok) { setErr(d.error ?? "error"); return; }
    setEmail(d.email); setOpen(false); setForm({ email: "", password: "" });
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setEmail(null); setOpen(false); }

  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen((v) => !v)} aria-label="Cuenta" style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.nav} strokeWidth={1.8} aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 34, background: "white", color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, width: 240, zIndex: 45, boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
          {email ? (
            <>
              <div style={{ fontSize: 13, color: C.mute, marginBottom: 8, wordBreak: "break-all" }}>{email}</div>
              <button onClick={() => { setModal("orders"); setOpen(false); }} style={{ ...primaryBtn(G), width: "100%", padding: 10, marginBottom: 6 }}>Mis pedidos</button>
              {showPets && <button onClick={() => { setModal("pets"); setOpen(false); }} style={{ ...outlineBtn(G), width: "100%", padding: 10, marginBottom: 6 }}>🐾 Mis mascotas</button>}
              <button onClick={logout} style={{ border: "none", background: "transparent", color: C.mute, cursor: "pointer", fontSize: 13, width: "100%", padding: 6 }}>Cerrar sesión</button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {(["login", "register"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} style={{ flex: 1, border: "none", borderRadius: 7, padding: 6, cursor: "pointer", background: mode === m ? G : "#eee", color: mode === m ? "white" : "#333", fontSize: 12, fontWeight: 600, fontFamily: FONT }}>{m === "login" ? "Ingresar" : "Registrarme"}</button>
                ))}
              </div>
              <input placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...input, marginBottom: 6 }} />
              <input placeholder="contraseña" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} style={input} />
              {err && <p style={{ color: "#c62828", fontSize: 12, margin: "6px 0 0" }}>{err}</p>}
              <button onClick={submit} style={{ ...primaryBtn(G), width: "100%", padding: 10, marginTop: 8 }}>{mode === "login" ? "Ingresar" : "Crear cuenta"}</button>
            </>
          )}
        </div>
      )}
      {modal === "orders" && <MyOrdersModal onClose={() => setModal("")} />}
      {modal === "pets" && <MyPetsModal G={G} factors={factors} onClose={() => setModal("")} />}
    </span>
  );
}

interface CustomerOrder { orderId: string; status: string; fulfillment: string | null; currency: string; totalMinor: string; itemCount: number; createdAt: string }
function orderLabel(status: string, fulfillment: string | null): { label: string; color: string } {
  if (status === "cancelled") return { label: "Cancelado", color: "#c62828" };
  if (status === "refunded" || status === "partially_refunded") return { label: "Reembolsado", color: "#777" };
  if (status === "pending_payment") return { label: "Pendiente de pago", color: "#b26a00" };
  switch (fulfillment) {
    case "delivered": return { label: "Entregado", color: "#2e7d32" };
    case "in_transit": return { label: "En camino", color: "#00796b" };
    case "ready": return { label: "Listo", color: "#8e24aa" };
    case "preparing": return { label: "En preparación", color: "#1a73e8" };
    default: return { label: "En proceso", color: "#1a73e8" };
  }
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16, zIndex: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", color: C.text, borderRadius: 16, maxWidth: 520, width: "100%", maxHeight: "88vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.3)", textAlign: "left" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: "white" }}>
          <strong style={{ fontSize: 17 }}>{title}</strong>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22 }}>×</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function MyOrdersModal({ onClose }: { onClose: () => void }) {
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/account/orders").then((r) => r.json()).then((d) => { if (d.orders) setOrders(d.orders); else setError(d.error ?? "error"); }).catch((e) => setError(String(e))); }, []);
  return (
    <Modal title="Mis pedidos" onClose={onClose}>
      {error && <p style={{ color: "#c00" }}>Error: {error}</p>}
      {!orders && !error && <p style={{ color: C.mute }}>Cargando…</p>}
      {orders && orders.length === 0 && <p style={{ color: C.mute }}>Todavía no tenés pedidos.</p>}
      {orders && orders.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {orders.map((o) => { const s = orderLabel(o.status, o.fulfillment); return (
            <li key={o.orderId} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span><strong>#{o.orderId.slice(0, 8)}</strong> <span style={{ color: C.mute, fontSize: 13 }}>· {o.itemCount} ítem(s)</span></span>
                <span style={{ background: s.color, color: "white", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>{s.label}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 13, color: "#555" }}>
                <span>{new Date(o.createdAt).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <b>{money(o.totalMinor)}</b>
              </div>
            </li>
          ); })}
        </ul>
      )}
    </Modal>
  );
}

interface MyPet { id: string; name: string; species: string; breed: string | null; weightKg: number | null; activity: string }
interface Replenish { pet: { name: string; weightKg: number } | null; items: Array<{ orderId: string; productName: string; runOutAt: string; daysLeft: number; totalDays: number }> }
function MyPetsModal({ G, factors, onClose }: { G: string; factors: Record<string, number>; onClose: () => void }) {
  const [pets, setPets] = useState<MyPet[]>([]);
  const [rep, setRep] = useState<Replenish | null>(null);
  const [f, setF] = useState({ name: "", species: "perro", breed: "", weightKg: "", activity: "adulto_normal" });
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/account/pets").then((r) => r.json()).then((d) => { if (d.pets) setPets(d.pets); }).catch(() => {});
    fetch("/api/account/replenishment").then((r) => r.json()).then((d) => setRep(d)).catch(() => {});
  };
  useEffect(load, []);

  async function add() {
    if (!f.name.trim()) { setError("Poné un nombre"); return; }
    setError(null);
    const res = await fetch("/api/account/pets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, weightKg: Number(f.weightKg) }) });
    if (!res.ok) { const d = await res.json(); setError(d.error ?? "error"); return; }
    setF({ name: "", species: f.species, breed: "", weightKg: "", activity: "adulto_normal" });
    load();
  }
  async function del(id: string) { await fetch(`/api/account/pets/${id}`, { method: "DELETE" }); load(); }

  return (
    <Modal title="Mis mascotas" onClose={onClose}>
      {pets.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "grid", gap: 8 }}>
          {pets.map((p) => (
            <li key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><strong>{p.name}</strong> <span style={{ color: C.mute, fontSize: 13 }}>{p.species}{p.weightKg ? ` · ${p.weightKg} kg` : ""} · {ACTIVITY_LABEL[p.activity] ?? p.activity}</span></span>
              <button onClick={() => del(p.id)} style={{ border: "none", background: "transparent", color: "#c62828", cursor: "pointer", fontSize: 13 }}>Borrar</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Agregar mascota</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
          <select value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} style={{ ...input, width: 100 }}><option value="perro">Perro</option><option value="gato">Gato</option><option value="otro">Otro</option></select>
          <input placeholder="Peso (kg)" value={f.weightKg} onChange={(e) => setF({ ...f, weightKg: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" style={{ ...input, width: 100 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input placeholder="Raza (opcional)" value={f.breed} onChange={(e) => setF({ ...f, breed: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
          <select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} style={{ ...input, flex: 1, minWidth: 160 }}>
            {Object.keys({ ...DEFAULT_FACTORS, ...factors }).map((k) => <option key={k} value={k}>{ACTIVITY_LABEL[k] ?? k}</option>)}
          </select>
        </div>
        {error && <p style={{ color: "#c62828", fontSize: 12.5, margin: "8px 0 0" }}>{error}</p>}
        <button onClick={add} style={{ ...primaryBtn(G), padding: 10, marginTop: 10 }}>Agregar</button>
      </div>

      {rep && rep.items.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🔔 Reposición estimada <span style={{ fontSize: 12, color: C.mute, fontWeight: 400 }}>(para {rep.pet?.name})</span></div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {rep.items.map((it, i) => (
              <li key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13.5 }}><strong>{it.productName}</strong></span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: it.daysLeft <= 5 ? "#c62828" : it.daysLeft <= 12 ? "#b26a00" : "#2e7d32" }}>
                  {it.daysLeft <= 0 ? "Reponer ya" : `Te quedan ≈ ${it.daysLeft} días`}
                </span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 11.5, color: C.mute, marginTop: 6 }}>Estimación según el consumo de tu mascota. Ante la duda, consultá con tu veterinario.</p>
        </div>
      )}
    </Modal>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────────
function Footer({ G, displayName, blurb, categories, onCategory, onHome }: { G: string; displayName: string; blurb: string; categories: { name: string; count: number }[]; onCategory: (c: string) => void; onHome: () => void }) {
  const colTitle: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "#5A594F", letterSpacing: ".07em", marginBottom: 12 };
  const link: React.CSSProperties = { fontSize: 13, color: C.mute, cursor: "pointer", marginBottom: 7 };
  return (
    <footer style={{ background: C.beige, borderTop: `1px solid ${C.border}`, padding: "44px 24px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: G }}>{displayName.toUpperCase()}</div>
          {blurb && <p style={{ fontSize: 13, color: C.mute, lineHeight: 1.7, marginTop: 10 }}>{blurb}</p>}
        </div>
        <div>
          <div style={colTitle}>TIENDA</div>
          <div style={link} onClick={onHome}>Inicio</div>
          {categories.slice(0, 4).map((c) => <div key={c.name} style={link} onClick={() => onCategory(c.name)}>{c.name}</div>)}
        </div>
        <div>
          <div style={colTitle}>AYUDA</div>
          <div style={link}>Envíos y entregas</div>
          <div style={link}>Medios de pago</div>
          <div style={link}>Preguntas frecuentes</div>
        </div>
        <div>
          <div style={colTitle}>CONTACTO</div>
          <div style={link}>WhatsApp</div>
          <div style={link}>Gualeguay, Entre Ríos</div>
          <div style={link}>Lun a Sáb 9 a 21 hs</div>
        </div>
      </div>
    </footer>
  );
}
