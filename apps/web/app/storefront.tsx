"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShoppingCart, Check as LuCheck, Search, Menu, User, MapPin, Plus, RotateCcw,
  Truck, Package, Scale, Tag, PawPrint, HeartHandshake, BarChart3, Dog, Cat,
} from "lucide-react";

// ── Tipos que provee el server component (page.tsx) ────────────────────────────
export interface StoreVariant {
  variantId: string;
  size: string; // nombre de la variante = talle/peso
  priceMinor: string;
  currency: string;
  netWeightKg: number | null; // peso neto de la bolsa (alimentos)
  listPriceMinor: string | null; // precio anterior (oferta), null = sin oferta
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
  imageUrl: string;
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
  quickReorder: boolean;
  nutritionFactors: Record<string, number>;
}

// ── Design tokens (handoff) ────────────────────────────────────────────────────
const C = {
  greenD: "#087A50",
  lightGreen: "#66BB6A",
  beige: "#F7F3EA",
  surf: "#F7F6F2",
  tint: "#EAF5EE",
  iconBg: "#E4F2EA",
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

// URL de imagen placeholder VÁLIDA (foto real) mientras no cargue la definitiva desde el panel.
// Determinista por `seed` para que cada categoría/producto tenga una foto estable.
function phImg(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed || "petshop")}/${w}/${h}`;
}
function onImgError(e: React.SyntheticEvent<HTMLImageElement>, seed: string, w: number, h: number) {
  const img = e.currentTarget;
  const fallback = phImg(seed, w, h);
  if (img.src !== fallback) img.src = fallback; // si la URL del panel falla, caemos al placeholder
}

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
type PayMethod = "transferencia" | "efectivo" | "pos" | "mercadopago";
type StorePetLite = { id: string; name: string; species: string };
type ReorderItem = { variantId: string; name: string; size: string; qty: number; priceMinor: string | null; available: number };
type Reorder = { orderId: string; petName: string | null; createdAt: string; items: ReorderItem[] };

interface Quote {
  gmvMinor: string;
  deliveryChargeMinor: string;
  discountMinor: string;
  totalMinor: string;
  missingForFreeMinor: string;
  zoneEtaMinutes?: number | null;
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
  heroImageUrl: string;
  adoptionsBannerImageUrl: string;
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
  const [payment, setPayment] = useState<PayMethod>("transferencia");
  const [form, setForm] = useState({ street: "", zone: "", phone: "", notes: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; totalMinor: string; petName: string | null } | null>(null);

  // ── Cliente + mascota protagonista en el checkout ────────────────────────────
  // El teléfono es la llave del cliente (sin obligar a registrarse). Con él reconocemos al
  // dueño y traemos sus mascotas para "¿Para quién compramos hoy?". Si no lo reconocemos,
  // pedimos el nombre de la mascota de forma natural (no obligatorio para comprar).
  const [customerName, setCustomerName] = useState("");
  const [knownPets, setKnownPets] = useState<StorePetLite[]>([]);
  const [greetName, setGreetName] = useState<string | null>(null);
  const [petSel, setPetSel] = useState<string>(""); // id de mascota elegida, o "" (ninguna/nueva)
  const [newPet, setNewPet] = useState({ name: "", species: "perro", weight: "" });
  // Compra rápida: última compra del cliente reconocido (para "repetir en 1 clic").
  const [reorder, setReorder] = useState<Reorder | null>(null);
  // Zonas de reparto del comercio (costo/tiempo por barrio). Vacío = envío plano.
  const [zones, setZones] = useState<Array<{ name: string; customerChargeMinor: string; etaMinutes: number | null }>>([]);
  // Ubicación opcional del cliente (GPS del navegador, gratis, sin API key). `acc` = precisión (m).
  const [geo, setGeo] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  function shareLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setError("Tu navegador no permite compartir ubicación."); return; }
    setError(null);
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)), acc: Math.round(pos.coords.accuracy || 0) });
        setGeoBusy(false);
      },
      (err) => {
        setError(err.code === err.PERMISSION_DENIED
          ? "No diste permiso de ubicación. Podés seguir con la dirección escrita."
          : "No pudimos obtener tu ubicación. Probá de nuevo o seguí con la dirección escrita.");
        setGeoBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

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
      .map((c) => ({ name: c.name, count: counts.get(c.name)!, imageUrl: c.imageUrl }));
    // Fallback: categorías presentes en productos pero no en la lista provista.
    for (const [name, count] of counts) if (!props.categories.some((c) => c.name === name)) ordered.push({ name, count, imageUrl: "" });
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

  // Compra rápida: buscamos la última compra del cliente reconocido (logueado).
  useEffect(() => {
    if (!config.quickReorder) return;
    fetch("/api/account/reorder")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.reorder?.items?.length) setReorder(d.reorder as Reorder); })
      .catch(() => {});
  }, [config.quickReorder]);

  // Repite la última compra: agrega al carrito lo disponible (precio actual).
  function repeatReorder() {
    if (!reorder) return;
    setCart((c) => {
      const next = { ...c };
      for (const it of reorder.items) {
        if (it.available <= 0 || it.priceMinor == null) continue;
        next[it.variantId] = { name: it.name, sub: it.size, priceMinor: Number(it.priceMinor), qty: Math.min(it.qty, it.available) };
      }
      return next;
    });
    setDone(null);
    setCartOpen(true);
  }

  // ── Quote del servidor (al entrar al checkout y al cambiar entrega/pago) ──────
  const fetchQuote = useCallback(async () => {
    if (items.length === 0) { setQuote(null); return; }
    try {
      const res = await fetch(`/api/checkout/quote?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: items.map(([variantId, l]) => ({ variantId, qty: l.qty })), delivery, payment, zone: form.zone }),
      });
      const d = await res.json();
      if (res.ok) setQuote(d); else setError(d.error ?? "error");
    } catch (e) { setError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, delivery, payment, form.zone, JSON.stringify(cart)]);

  useEffect(() => { if (view === "checkout") void fetchQuote(); }, [view, fetchQuote]);

  // Zonas de reparto (para el selector de barrio del checkout).
  useEffect(() => {
    if (view !== "checkout" || zones.length > 0) return;
    fetch(`/api/zones?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.zones?.length) setZones(d.zones); })
      .catch(() => {});
  }, [view, tenant, zones.length]);

  // Cliente logueado: traemos sus mascotas al entrar al checkout (su alimento habitual va acá).
  useEffect(() => {
    if (view !== "checkout") return;
    fetch("/api/account/pets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.pets?.length) { setKnownPets(d.pets as StorePetLite[]); } })
      .catch(() => {});
  }, [view]);

  // Guest: reconocemos al cliente por teléfono (debounce). Traemos su nombre y sus mascotas
  // para saludarlo y ofrecer "¿Para quién compramos hoy?". No bloquea la compra.
  useEffect(() => {
    const digits = form.phone.replace(/\D+/g, "");
    if (view !== "checkout" || digits.length < 6) { setGreetName(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/customer/lookup?tenant=${encodeURIComponent(tenant)}&phone=${encodeURIComponent(digits)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          if (d.found) {
            setGreetName(d.name ?? null);
            if (d.name && !customerName.trim()) setCustomerName(d.name);
            if (Array.isArray(d.pets) && d.pets.length) setKnownPets(d.pets as StorePetLite[]);
          } else {
            setGreetName(null);
          }
        })
        .catch(() => {});
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone, view, tenant]);

  const selectedPet = knownPets.find((p) => p.id === petSel) ?? null;

  async function confirmOrder() {
    if (!form.street.trim()) { setError("Ingresá la calle y número de entrega."); return; }
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // Para quién es: mascota elegida, o alta rápida con el nombre que escribieron.
      const petFields = selectedPet
        ? { petId: selectedPet.id }
        : newPet.name.trim()
          ? { petName: newPet.name.trim(), petSpecies: newPet.species, ...(Number(newPet.weight) > 0 ? { petWeightKg: Number(newPet.weight) } : {}) }
          : {};
      const res = await fetch(`/api/checkout?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          items: items.map(([variantId, l]) => ({ variantId, qty: l.qty })),
          address: { street: form.street, zone: form.zone, phone: form.phone, notes: form.notes, ...(geo ? { lat: geo.lat, lng: geo.lng } : {}) },
          delivery,
          payment,
          ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
          ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
          ...petFields,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "error en el checkout"); return; }
      // Mostramos el total cotizado (con descuento) que el cliente confirmó.
      const shownTotal = quote?.totalMinor ?? d.totalMinor;
      setDone({ orderId: d.orderId, totalMinor: shownTotal, petName: d.petName ?? selectedPet?.name ?? newPet.name.trim() ?? null });
      setCart({});
      setPetSel(""); setNewPet({ name: "", species: "perro", weight: "" });
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
        img{max-width:100%;}
        .sf-img{display:block;}
        /* ── Responsive: tablet / nav a hamburguesa ── */
        @media (max-width:960px){
          .sf-nav{display:none !important;}
          .sf-burger{display:inline-flex !important;}
        }
        @media (max-width:900px){
          .sf-hero{grid-template-columns:1fr !important;}
          .sf-hero>div:first-child{padding:34px 26px !important;}
          .sf-hero-art{min-height:280px !important;order:-1;}
          .sf-adopt{grid-template-columns:1fr !important;}
          .sf-adopt-art{min-height:220px !important;order:-1;}
          .sf-listwrap{grid-template-columns:1fr !important;}
          .sf-detail{grid-template-columns:1fr !important;gap:26px !important;}
          .sf-checkout{grid-template-columns:1fr !important;}
          .sf-checkout-sum{position:static !important;}
          .sf-cats{grid-template-columns:repeat(4,1fr) !important;}
          .sf-featured,.sf-list{grid-template-columns:repeat(3,1fr) !important;}
          .sf-benefits{grid-template-columns:repeat(2,1fr) !important;}
          .sf-footer{grid-template-columns:1fr 1fr !important;gap:24px !important;}
        }
        /* ── Responsive: teléfono ── */
        @media (max-width:640px){
          .sf-header{gap:12px !important;padding:11px 14px !important;flex-wrap:wrap !important;}
          .sf-search input{width:100% !important;}
          .sf-search{flex:1 1 120px !important;}
          .sf-right{flex:1 1 100% !important;}
          .sf-main{padding:18px 14px 60px !important;}
          .sf-topbar-help{display:none !important;}
          .sf-topbar{justify-content:center !important;padding:7px 14px !important;}
          .sf-cats,.sf-featured,.sf-list{grid-template-columns:repeat(2,1fr) !important;gap:12px !important;}
          .sf-benefits{grid-template-columns:repeat(2,1fr) !important;}
          .sf-checkout-grid2{grid-template-columns:1fr !important;}
          .sf-footer{grid-template-columns:1fr !important;}
          .sf-hero h1{font-size:31px !important;}
        }
        @media (max-width:380px){
          .sf-featured,.sf-list{grid-template-columns:1fr !important;}
        }
      `}</style>

      {/* Barra superior: envío gratis (config) + ayuda/WhatsApp */}
      <div style={{ background: G, color: C.white, fontSize: 12.5, fontWeight: 500 }}>
        <div className="sf-topbar" style={{ maxWidth: 1280, margin: "0 auto", padding: "7px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 16, position: "relative" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <WaIcon size={14} />Envíos gratis en Gualeguay en compras superiores a {money(threshold)}
          </span>
          {props.whatsapp && (
            <a href={waLink()!} target="_blank" rel="noopener noreferrer" className="sf-topbar-help" style={{ position: "absolute", right: 24, display: "inline-flex", alignItems: "center", gap: 8, color: C.white, textDecoration: "none", fontWeight: 500 }}>
              ¿Necesitás ayuda? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 }}><WaIcon size={14} />{props.whatsapp}</span>
            </a>
          )}
        </div>
      </div>

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

      <main className="sf-main" style={{ maxWidth: view === "checkout" ? 1000 : view === "done" ? 620 : 1280, margin: "0 auto", padding: view === "done" ? "90px 24px 120px" : "28px 24px 80px" }}>
        {view === "home" && reorder && reorder.items.some((it) => it.available > 0) && (
          <QuickReorder G={G} reorder={reorder} onRepeat={repeatReorder} />
        )}
        {view === "home" && (
          <HomeView
            G={G} products={products} categories={categories} config={config} threshold={threshold} content={props.content}
            heroImageUrl={props.heroImageUrl} adoptionsBannerImageUrl={props.adoptionsBannerImageUrl}
            adoptionsLabel={props.adoptions.length > 0 ? props.adoptionsTitle : ""} onAdoptions={() => go("adopciones")}
            comparatorEnabled={config.foodComparator && foodProducts.length >= 2} onComparar={() => go("comparar")}
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
            knownPets={knownPets} greetName={greetName} petSel={petSel} setPetSel={setPetSel}
            newPet={newPet} setNewPet={setNewPet} customerName={customerName} setCustomerName={setCustomerName}
            factors={config.nutritionFactors}
            geo={geo} geoBusy={geoBusy} onShareLocation={shareLocation} onClearLocation={() => setGeo(null)}
            zones={zones}
            onConfirm={confirmOrder}
          />
        )}

        {view === "done" && done && (
          <DoneView G={G} tenant={tenant} orderId={done.orderId} totalMinor={done.totalMinor} petName={done.petName} onHome={() => { setCategory(""); setQuery(""); go("home"); }} />
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
// Envuelven lucide-react para no tocar los call-sites existentes (misma familia de iconos).
function CartIcon({ size = 18 }: { size?: number }) {
  return <ShoppingCart size={size} strokeWidth={1.9} aria-hidden />;
}
function Check({ size = 16, sw = 2 }: { size?: number; sw?: number }) {
  return <LuCheck size={size} strokeWidth={sw} aria-hidden />;
}

// ── Placeholder de imagen (foto real cuando exista) ─────────────────────────────
/**
 * Imagen REAL de la tienda. Siempre renderiza <img> con una URL: la definitiva (del panel) o,
 * si está vacía, una placeholder VÁLIDA (foto real, estable por `seed`). Nunca una caja/emoji.
 * `w`×`h` definen el tamaño del placeholder (512×512 categorías, 1080×450 hero, etc.).
 */
function Img({ src, alt, ratio, radius, seed, w = 512, h = 512, fit = "cover", height }: {
  src?: string; alt: string; ratio?: string; radius: React.CSSProperties["borderRadius"];
  seed: string; w?: number; h?: number; fit?: "cover" | "contain"; height?: number;
}) {
  const url = src && src.length > 0 ? src : phImg(seed, w, h);
  const style: React.CSSProperties = {
    width: "100%", borderRadius: radius, objectFit: fit, display: "block",
    background: C.beige, ...(ratio ? { aspectRatio: ratio } : {}), ...(height ? { height } : {}),
  };
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="sf-img" src={url} alt={alt} loading="lazy" style={style} onError={(e) => onImgError(e, seed, w, h)} />;
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
  const [menu, setMenu] = useState(false);
  const nav = (fn: () => void) => { setMenu(false); fn(); };
  const Logo = () => props.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.logoUrl} alt={props.displayName} style={{ height: 46, width: "auto", maxWidth: 190, objectFit: "contain", display: "block" }} />
  ) : (
    <>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: C.iconBg, color: G, display: "grid", placeItems: "center", flexShrink: 0 }}><PawPrint size={24} strokeWidth={1.9} /></span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
        <span style={{ fontSize: 19, fontWeight: 800, color: G, letterSpacing: ".01em" }}>{props.displayName.replace(/gualeguay/i, "").trim().toUpperCase() || "PET SHOP"}</span>
        <span style={{ fontSize: 10.5, fontWeight: 500, color: C.mute, marginTop: 3 }}>Más que mascotas, familia</span>
      </span>
    </>
  );
  return (
    <header className="sf-header" style={{ position: "sticky", top: 0, zIndex: 40, background: C.white, borderBottom: `1px solid ${C.border}`, padding: "12px 24px", display: "flex", gap: 28, alignItems: "center" }}>
      {/* Hamburguesa (solo mobile) */}
      <button className="sf-burger" onClick={() => setMenu((v) => !v)} aria-label="Menú" style={{ display: "none", border: "none", background: "transparent", cursor: "pointer", color: C.text, padding: 4 }}>
        <Menu size={24} strokeWidth={2} />
      </button>

      {/* Logo */}
      <div className="sf-a" onClick={props.onHome} style={{ display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}><Logo /></div>

      {/* Nav (desktop) */}
      <nav className="sf-nav" style={{ flex: 1, display: "flex", gap: "10px 22px", fontSize: 13.5, flexWrap: "wrap", alignContent: "center" }}>
        <NavItem label="Inicio" active={props.activeCat === "" && !props.query} onClick={props.onHome} G={G} />
        {props.categories.map((c) => (
          <NavItem key={c.name} label={c.name} active={props.activeCat === c.name} onClick={() => props.onCategory(c.name)} G={G} />
        ))}
        {props.comparatorLabel && <NavItem label={props.comparatorLabel} active={props.comparatorActive} onClick={props.onComparar} G={G} />}
        {props.adoptionsLabel && <NavItem label={props.adoptionsLabel} active={props.adoptionsActive} onClick={props.onAdoptions} G={G} />}
        {props.waLink && <a href={props.waLink} target="_blank" rel="noopener noreferrer" style={{ color: C.nav, fontWeight: 500, textDecoration: "none", borderBottom: "2px solid transparent", paddingBottom: 3 }}>Contacto</a>}
      </nav>

      {/* Derecha */}
      <div className="sf-right" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div className="sf-search" style={{ display: "flex", alignItems: "center", gap: 8, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 999, padding: "7px 14px" }}>
          <Search size={16} strokeWidth={2} color={C.mute} aria-hidden />
          <input value={props.query} onChange={(e) => props.onSearch(e.target.value)} placeholder="Buscar productos" style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, width: 150, fontFamily: FONT, color: C.text }} />
        </div>
        <AccountMenu G={G} tenant={props.tenant} showPets={props.showPets} factors={props.factors} />
        <button className="sf-btn" onClick={props.onCart} style={{ background: G, color: C.white, border: "none", borderRadius: 999, padding: "8px 16px", display: "inline-flex", alignItems: "center", gap: 9, cursor: "pointer", fontFamily: FONT }}>
          <CartIcon size={18} /><span style={{ fontSize: 14, fontWeight: 600 }}>{money(props.subtotal)}</span>
        </button>
      </div>

      {/* Menú móvil */}
      {menu && (
        <div style={{ position: "fixed", inset: 0, top: 0, zIndex: 60 }} onClick={() => setMenu(false)}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(20,22,20,.4)" }} />
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 280, maxWidth: "85vw", background: C.white, boxShadow: "8px 0 40px rgba(0,0,0,.18)", padding: "18px 20px", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 800, fontSize: 16, color: G }}>Menú</span>
              <button onClick={() => setMenu(false)} aria-label="Cerrar" style={{ border: "none", background: "transparent", fontSize: 24, color: C.mute, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <MobileLink label="Inicio" onClick={() => nav(props.onHome)} />
              {props.categories.map((c) => <MobileLink key={c.name} label={c.name} onClick={() => nav(() => props.onCategory(c.name))} />)}
              {props.comparatorLabel && <MobileLink label={props.comparatorLabel} onClick={() => nav(props.onComparar)} />}
              {props.adoptionsLabel && <MobileLink label={props.adoptionsLabel} onClick={() => nav(props.onAdoptions)} />}
              {props.waLink && <a href={props.waLink} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)} style={{ padding: "12px 6px", fontSize: 15, color: C.text, textDecoration: "none", borderTop: `1px solid ${C.border}` }}>Contacto por WhatsApp</a>}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
function MobileLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} style={{ textAlign: "left", padding: "12px 6px", fontSize: 15, fontWeight: 500, color: C.text, background: "transparent", border: "none", borderTop: `1px solid ${C.border}`, cursor: "pointer", fontFamily: FONT }}>{label}</button>;
}
function NavItem({ label, active, onClick, G }: { label: string; active: boolean; onClick: () => void; G: string }) {
  return (
    <span className="sf-a" onClick={onClick} style={{ fontWeight: active ? 600 : 500, color: active ? G : C.nav, borderBottom: `2px solid ${active ? G : "transparent"}`, paddingBottom: 3 }}>{label}</span>
  );
}

// ── Product card ─────────────────────────────────────────────────────────────────
function ProductCard({ G, p, listRow, onOpen, onAdd }: { G: string; p: StoreProduct; listRow?: boolean; onOpen: () => void; onAdd: () => void }) {
  const v = p.variants[p.variants.length - 1]!;
  const price = Number(v.priceMinor);
  const listPrice = v.listPriceMinor != null ? Number(v.listPriceMinor) : null;
  const onSale = listPrice != null && listPrice > price;
  const discount = onSale ? Math.round((1 - price / listPrice!) * 100) : 0;
  const sub = v.size;
  return (
    <div className="sf-card" style={{ border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, background: C.white, display: "flex", flexDirection: "column", gap: 11 }}>
      <div className="sf-a" onClick={onOpen} style={{ position: "relative" }}>
        <Img src={p.imageUrl} alt={p.name} ratio="1" radius={12} seed={p.productId} />
        {onSale && (
          <span style={{ position: "absolute", top: 10, right: 10, background: G, color: C.white, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "3px 9px", boxShadow: "0 2px 8px rgba(0,0,0,.12)" }}>−{discount}%</span>
        )}
      </div>
      <div className="sf-a" onClick={onOpen} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: listRow ? 15 : 14.5, fontWeight: 600, lineHeight: 1.3 }}>{p.name}</span>
        <span style={{ fontSize: 12, color: C.mute }}>{sub}{p.category ? ` · ${p.category}` : ""}</span>
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: listRow ? 20 : 21, fontWeight: 700, color: G }}>{money(price)}</span>
        {onSale && <span style={{ fontSize: 13, color: C.mute, textDecoration: "line-through" }}>{money(listPrice!)}</span>}
      </div>
      {listRow ? (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
          <button className="sf-btn" onClick={onAdd} style={{ background: G, color: C.white, border: "none", borderRadius: 9, padding: "10px 15px", fontSize: 12, fontWeight: 600, letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, fontFamily: FONT }}><CartIcon size={15} />AGREGAR</button>
        </div>
      ) : (
        <button className="sf-btn" onClick={onAdd} style={{ background: G, color: C.white, border: "none", borderRadius: 9, padding: 11, fontSize: 12.5, fontWeight: 600, letterSpacing: ".04em", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: FONT }}><CartIcon size={15} />AGREGAR</button>
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

// ── Compra rápida: repetir la última compra en 1 clic ─────────────────────────────
function QuickReorder({ G, reorder, onRepeat }: { G: string; reorder: Reorder; onRepeat: () => void }) {
  const items = reorder.items.filter((it) => it.available > 0);
  const total = items.reduce((a, it) => a + (it.priceMinor ? Number(it.priceMinor) * Math.min(it.qty, it.available) : 0), 0);
  const forPet = reorder.petName?.trim();
  return (
    <section style={{ background: C.tint, border: `1px solid ${C.border}`, borderRadius: 18, padding: "20px 22px", marginBottom: 26, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 12.5, color: G, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}><RotateCcw size={13} strokeWidth={2} style={{verticalAlign:"-2px",marginRight:5}} />Compra rápida</div>
        <div style={{ fontSize: 19, fontWeight: 700, marginTop: 3 }}>
          {forPet ? <>¿Repetimos lo de {forPet}?</> : <>¿Repetimos tu última compra?</>}
        </div>
        <div style={{ fontSize: 13.5, color: C.text2, marginTop: 4 }}>
          {items.slice(0, 3).map((it) => `${it.qty}× ${it.name}`).join(" · ")}{items.length > 3 ? ` +${items.length - 3}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        {total > 0 && <div style={{ fontSize: 20, fontWeight: 800, color: G }}>{money(total)}</div>}
        <button className="sf-btn" onClick={onRepeat} style={{ ...primaryBtn(G), padding: "12px 22px", marginTop: 6 }}>REPETIR COMPRA</button>
      </div>
    </section>
  );
}

// Beneficios: textos por defecto + icono de lucide por posición (misma familia de iconos).
const DEFAULT_BENEFITS: Array<{ t: string; s: string }> = [
  { t: "Envío de Auxilio", s: "Emergencias 20:00–23:00, feriados 10:00–22:00" },
  { t: "Bolsas cerradas", s: "10 / 15 kg – las mejores marcas" },
  { t: "Fraccionado por kilo", s: "1,5 / 3 / 5 kg" },
  { t: "Ofertas todas las semanas", s: "Precios especiales" },
];
const BENEFIT_ICONS = [Truck, Package, Scale, Tag];

function HomeView(props: {
  G: string; products: StoreProduct[]; categories: { name: string; count: number; imageUrl?: string }[]; config: StoreConfig; threshold: number; content: StoreContent;
  heroImageUrl: string; adoptionsBannerImageUrl: string;
  adoptionsLabel: string; onAdoptions: () => void; comparatorEnabled: boolean; onComparar: () => void;
  waLink: string | null; onSeeList: () => void; onCategory: (c: string) => void; onOpen: (p: StoreProduct) => void; onAdd: (p: StoreProduct) => void;
}) {
  const { G, content } = props;
  const benefits = content.benefits.length >= 3 ? content.benefits.slice(0, 4) : DEFAULT_BENEFITS;
  // Ofertas primero, después el resto, hasta llenar la fila.
  const onSale = (p: StoreProduct) => { const v = p.variants[p.variants.length - 1]!; return v.listPriceMinor != null && Number(v.listPriceMinor) > Number(v.priceMinor); };
  const featured = [...props.products].sort((a, b) => Number(onSale(b)) - Number(onSale(a))).slice(0, Math.max(props.config.featuredCount, 6));
  const cats = props.categories.slice(0, 8);
  return (
    <>
      {/* Hero */}
      <section className="sf-hero" style={{ background: C.beige, borderRadius: 20, padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", overflow: "hidden" }}>
        <div style={{ padding: "52px 46px" }}>
          <h1 style={{ margin: 0, fontSize: 44, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-.02em", maxWidth: 460 }}>
            {content.heroTitle} {content.heroHighlight && <span style={{ color: G }}>{content.heroHighlight}</span>}
          </h1>
          {content.heroSubtitle && <p style={{ fontSize: 16, color: C.text2, lineHeight: 1.6, marginTop: 18, maxWidth: 440 }}>{content.heroSubtitle}</p>}
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            {props.waLink && <a className="sf-btn" href={props.waLink} target="_blank" rel="noopener noreferrer" style={{ ...primaryBtn(G), textDecoration: "none" }}><WaIcon size={17} />Hacé tu pedido por WhatsApp</a>}
            <button className="sf-btn" onClick={props.onSeeList} style={outlineBtn(G)}>Ver productos</button>
          </div>
        </div>
        {/* Imagen REAL del hero (URL desde config) + badge de envío gratis */}
        <div className="sf-hero-art" style={{ position: "relative", minHeight: 320 }}>
          <img className="sf-img" src={props.heroImageUrl && props.heroImageUrl.length > 0 ? props.heroImageUrl : phImg("hero-petshop", 1080, 900)} alt="Mascotas felices"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            onError={(e) => onImgError(e, "hero-petshop", 1080, 900)} />
          <div style={{ position: "absolute", right: 22, bottom: 22, width: 128, height: 128, borderRadius: "50%", background: G, color: C.white, boxShadow: "0 10px 28px rgba(0,0,0,.22)", display: "grid", placeItems: "center", textAlign: "center", padding: 12 }}>
            <span>
              <span style={{ display: "block" }}><Truck size={20} strokeWidth={1.9} /></span>
              <span style={{ display: "block", fontSize: 15, fontWeight: 800, marginTop: 2, lineHeight: 1 }}>ENVÍOS<br />GRATIS</span>
              <span style={{ display: "block", fontSize: 8.5, opacity: .92, marginTop: 3 }}>en compras superiores<br />a {money(props.threshold)}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Beneficios (íconos lucide, verde, lineal) */}
      <div className="sf-benefits" style={{ marginTop: 18, background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 24px", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
        {benefits.map((b, i) => {
          const Ico = BENEFIT_ICONS[i % BENEFIT_ICONS.length]!;
          return (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ color: G, flexShrink: 0 }}><Ico size={24} strokeWidth={1.9} /></span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{b.t}</span>
                <span style={{ fontSize: 12, color: C.mute }}>{b.s}</span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Categorías (imágenes REALES 512×512) */}
      {cats.length > 0 && (
        <>
          <SectionHead G={G} title="Nuestras categorías" action="Ver todas →" onAction={props.onSeeList} />
          <div className="sf-cats" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(8, cats.length)},1fr)`, gap: 16 }}>
            {cats.map((c) => (
              <div key={c.name} className="sf-a" onClick={() => props.onCategory(c.name)} style={{ textAlign: "center" }}>
                <div style={{ background: C.beige, borderRadius: 16, padding: 10 }}>
                  <Img src={c.imageUrl} alt={c.name} ratio="1" radius={12} seed={c.name} />
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 10, lineHeight: 1.25 }}>{c.name}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Ofertas destacadas (productos reales, imagen + badge + precio anterior + Agregar) */}
      <SectionHead G={G} title="Ofertas destacadas" action="Ver todas →" onAction={props.onSeeList} />
      {featured.length === 0 ? <p style={{ color: C.mute }}>Todavía no hay productos cargados.</p> : (
        <div className="sf-featured" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
          {featured.map((p) => <ProductCard key={p.productId} G={G} p={p} onOpen={() => props.onOpen(p)} onAdd={() => props.onAdd(p)} />)}
        </div>
      )}

      {/* Banner de adopciones (imagen REAL desde config) */}
      {props.adoptionsLabel && (
        <section className="sf-adopt" style={{ marginTop: 56, background: C.beige, borderRadius: 20, display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "stretch", overflow: "hidden" }}>
          <div style={{ padding: "40px 46px", display: "flex", gap: 22, alignItems: "center" }}>
            <span style={{ color: G, flexShrink: 0 }}><HeartHandshake size={58} strokeWidth={1.6} /></span>
            <div>
              <h2 style={{ margin: 0, fontSize: 27, fontWeight: 800, letterSpacing: "-.01em" }}>También podés ayudar</h2>
              <p style={{ fontSize: 15, color: C.text2, marginTop: 6 }}>Conocé mascotas que buscan un hogar</p>
              <button className="sf-btn" onClick={props.onAdoptions} style={{ ...outlineBtn(G), marginTop: 16 }}>Ver adopciones →</button>
            </div>
          </div>
          <div className="sf-adopt-art" style={{ position: "relative", minHeight: 240 }}>
            <div style={{ position: "absolute", inset: 0 }}>
              <Img src={props.adoptionsBannerImageUrl} alt="Mascotas en adopción" seed="adopciones" w={1080} h={600} radius={0} fit="cover" />
            </div>
          </div>
        </section>
      )}

      {/* Comparador de alimentos */}
      {props.comparatorEnabled && (
        <section style={{ marginTop: 22, background: C.tint, borderRadius: 20, padding: "34px 40px", display: "flex", gap: 22, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <span style={{ color: G, flexShrink: 0 }}><BarChart3 size={38} strokeWidth={1.8} /></span>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>¿No sabés qué alimento elegir?</h2>
              <p style={{ fontSize: 14.5, color: C.text2, marginTop: 5, maxWidth: 560 }}>Compará alimentos por el costo por día según el peso y las necesidades de tu mascota.</p>
            </div>
          </div>
          <button className="sf-btn" onClick={props.onComparar} style={outlineBtn(G)}>Comparar alimentos</button>
        </section>
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
      <div className="sf-listwrap" style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: 28, alignItems: "start", marginTop: 20 }}>
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
          <div className="sf-list" style={{ display: "grid", gridTemplateColumns: `repeat(${props.columns},1fr)`, gap: 18 }}>
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
      <div className="sf-detail" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "start" }}>
        <Img src={p.imageUrl} alt={p.name} ratio="1" radius={20} seed={p.productId} w={1080} h={1080} />
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

// Icono de especie con lucide (Dog / Cat / PawPrint). Nunca emoji.
function SpeciesIcon({ species, size = 16 }: { species: string; size?: number }) {
  if (species === "perro") return <Dog size={size} strokeWidth={1.8} />;
  if (species === "gato") return <Cat size={size} strokeWidth={1.8} />;
  return <PawPrint size={size} strokeWidth={1.8} />;
}

/**
 * Mini-mapa de confirmación: mosaico 3×3 de tiles de OpenStreetMap centrado en el punto del
 * cliente, con un pin en el centro. Gratis, sin API key ni librerías. Es solo una vista previa
 * (no arrastrable); el link "Ver en el mapa" abre el punto exacto.
 */
function MapPreview({ lat, lng, G }: { lat: number; lng: number; G: string }) {
  const z = 16;
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const xt = ((lng + 180) / 360) * n;
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const cx = Math.floor(xt), cy = Math.floor(yt);
  const fx = xt - cx, fy = yt - cy;
  // Punto dentro del mosaico 768×768 (el tile central es el índice 1 de 0..2).
  const px = (1 + fx) * 256, py = (1 + fy) * 256;
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    tiles.push({ x: ((cx - 1 + i) % n + n) % n, y: cy - 1 + j, left: i * 256, top: j * 256 });
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 172, overflow: "hidden", borderRadius: 12, border: `1px solid ${C.border}`, background: C.beige }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 768, height: 768, transform: `translate(${-px}px, ${-py}px)` }}>
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${t.x}-${t.y}`} src={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`} alt="" width={256} height={256}
            style={{ position: "absolute", left: t.left, top: t.top, width: 256, height: 256, display: "block" }} />
        ))}
      </div>
      {/* Pin fijo en el centro del viewport (el mapa se desplaza para centrar el punto). */}
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-100%)", color: G, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))" }}>
        <MapPin size={30} strokeWidth={2.2} fill={G} color="#fff" />
      </div>
      <div style={{ position: "absolute", right: 6, bottom: 4, fontSize: 9, color: "#5a5a5a", background: "rgba(255,255,255,.7)", borderRadius: 4, padding: "1px 5px" }}>© OpenStreetMap</div>
    </div>
  );
}

function CheckoutView(props: {
  G: string; items: [string, CartLine][]; config: StoreConfig; quote: Quote | null;
  delivery: "estandar" | "auxilio"; setDelivery: (d: "estandar" | "auxilio") => void;
  payment: PayMethod; setPayment: (p: PayMethod) => void;
  form: { street: string; zone: string; phone: string; notes: string }; setForm: (f: { street: string; zone: string; phone: string; notes: string }) => void;
  knownPets: StorePetLite[]; greetName: string | null; petSel: string; setPetSel: (id: string) => void;
  newPet: { name: string; species: string; weight: string }; setNewPet: (p: { name: string; species: string; weight: string }) => void;
  customerName: string; setCustomerName: (n: string) => void; factors: Record<string, number>;
  geo: { lat: number; lng: number; acc: number } | null; geoBusy: boolean; onShareLocation: () => void; onClearLocation: () => void;
  zones: Array<{ name: string; customerChargeMinor: string; etaMinutes: number | null }>;
  busy: boolean; error: string | null; subtotal: number; shippingFor: (d: "estandar" | "auxilio") => number; discountFor: (p: string) => number; onConfirm: () => void;
}) {
  const { G, form, setForm } = props;
  // Números autoritativos: quote del server; fallback a cálculo local mientras carga.
  const sub = props.quote ? Number(props.quote.gmvMinor) : props.subtotal;
  const ship = props.quote ? Number(props.quote.deliveryChargeMinor) : props.shippingFor(props.delivery);
  const disc = props.quote ? Number(props.quote.discountMinor) : props.discountFor(props.payment);
  const total = props.quote ? Number(props.quote.totalMinor) : sub + ship - disc;
  const card: React.CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 };
  const hasPets = props.knownPets.length > 0;
  const addingNew = !props.petSel; // sin mascota elegida → alta rápida / captura del nombre
  return (
    <>
      <h1 style={{ margin: "0 0 26px", fontSize: 32, fontWeight: 700, letterSpacing: "-.02em" }}>Finalizar compra</h1>
      <div className="sf-checkout" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 28, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Dirección de envío</div>
            <div className="sf-checkout-grid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Calle y número" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
              {props.zones.length > 0 ? (
                <select style={input} value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
                  <option value="">Elegí tu zona…</option>
                  {props.zones.map((z) => (
                    <option key={z.name} value={z.name}>{z.name} — {Number(z.customerChargeMinor) === 0 ? "gratis" : money(z.customerChargeMinor)}{z.etaMinutes ? ` · ${z.etaMinutes}′` : ""}</option>
                  ))}
                </select>
              ) : (
                <input style={input} placeholder="Barrio / zona" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
              )}
              <input style={input} placeholder="Teléfono / WhatsApp" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input style={{ ...input, gridColumn: "1 / -1" }} placeholder="Notas (timbre, referencia…)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {/* Ubicación opcional (GPS del navegador). Confirmación visual con mini-mapa. */}
            <div style={{ marginTop: 12 }}>
              {props.geo ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, color: G, fontWeight: 600, marginBottom: 8 }}>
                    <Check size={16} /> Ubicación compartida
                    {props.geo.acc > 0 && <span style={{ color: C.mute, fontWeight: 500 }}>· precisión ±{props.geo.acc} m</span>}
                  </div>
                  <MapPreview lat={props.geo.lat} lng={props.geo.lng} G={G} />
                  {props.geo.acc > 120 && (
                    <div style={{ fontSize: 11.5, color: "#b26a00", marginTop: 6 }}>La precisión es baja. Si el punto no es exacto, tocá “Actualizar ubicación”.</div>
                  )}
                  <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap", alignItems: "center" }}>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${props.geo.lat},${props.geo.lng}`} target="_blank" rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: G, textDecoration: "none" }}>
                      <MapPin size={14} strokeWidth={1.9} /> Ver en el mapa
                    </a>
                    <button type="button" onClick={props.onShareLocation} disabled={props.geoBusy}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", color: C.text2, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
                      <RotateCcw size={13} strokeWidth={2} /> {props.geoBusy ? "Actualizando…" : "Actualizar ubicación"}
                    </button>
                    <button type="button" onClick={props.onClearLocation}
                      style={{ border: "none", background: "transparent", color: C.mute, fontSize: 12.5, cursor: "pointer", textDecoration: "underline", fontFamily: FONT }}>Quitar</button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" onClick={props.onShareLocation} disabled={props.geoBusy}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px dashed ${C.border}`, background: C.white, borderRadius: 10, padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: C.text, cursor: "pointer", fontFamily: FONT }}>
                    <MapPin size={16} strokeWidth={1.9} />{props.geoBusy ? "Obteniendo ubicación…" : "Compartir mi ubicación (opcional)"}
                  </button>
                  <div style={{ fontSize: 11.5, color: C.mute, marginTop: 6 }}>Ayuda al repartidor a llegar exacto. No es obligatorio.</div>
                </>
              )}
            </div>
          </div>

          {/* La mascota es el centro. Si reconocemos al cliente por teléfono, lo saludamos y le
              mostramos sus mascotas. Si no, capturamos el nombre de forma natural (no obligatorio). */}
          <div style={card}>
            {props.greetName && (
              <div style={{ fontSize: 13.5, color: G, fontWeight: 600, marginBottom: 8 }}>¡Hola de nuevo, {props.greetName}!</div>
            )}
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{hasPets ? "¿Para quién compramos hoy?" : "¿Cómo se llama tu mascota?"}</div>
            <div style={{ fontSize: 12.5, color: C.mute, marginBottom: 14 }}>
              {hasPets ? "Elegí la mascota del pedido (o sumá una nueva)." : "Nos ayuda a cuidarla mejor y a avisarte cuando se le esté por acabar el alimento."}
            </div>

            {hasPets && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: addingNew ? 14 : 0 }}>
                {props.knownPets.map((p) => {
                  const on = props.petSel === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => props.setPetSel(on ? "" : p.id)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 999, cursor: "pointer",
                        border: `1.5px solid ${on ? G : C.border}`, background: on ? C.tint : C.white, fontSize: 13.5, fontWeight: 600, color: on ? G : C.text }}>
                      <SpeciesIcon species={p.species} size={16} />{p.name}
                    </button>
                  );
                })}
                <button type="button" onClick={() => props.setPetSel("")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 999, cursor: "pointer",
                    border: `1.5px dashed ${addingNew ? G : C.border}`, background: C.white, fontSize: 13.5, fontWeight: 600, color: addingNew ? G : C.mute }}>
                  <Plus size={15} strokeWidth={2} /> Agregar mascota
                </button>
              </div>
            )}

            {addingNew && (
              <div className="sf-checkout-grid2" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10 }}>
                <input style={input} placeholder="Nombre (ej: Bruno)" value={props.newPet.name} onChange={(e) => props.setNewPet({ ...props.newPet, name: e.target.value })} />
                <select style={input} value={props.newPet.species} onChange={(e) => props.setNewPet({ ...props.newPet, species: e.target.value })}>
                  <option value="perro">Perro</option>
                  <option value="gato">Gato</option>
                  <option value="otro">Otro</option>
                </select>
                <input style={input} placeholder="Peso kg (opcional)" inputMode="decimal" value={props.newPet.weight} onChange={(e) => props.setNewPet({ ...props.newPet, weight: e.target.value })} />
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Método de entrega</div>
            <RadioCard G={G} on={props.delivery === "estandar"}
              title="Envío estándar"
              sub={`En el día (13:00 a 20:00)${props.quote?.zoneEtaMinutes ? ` · ~${props.quote.zoneEtaMinutes} min` : ""}`}
              price={props.delivery === "estandar" ? (ship === 0 ? "Gratis" : money(ship)) : (sub >= Number(props.config.freeShippingThresholdMinor) ? "Gratis" : money(props.config.standardCostMinor))}
              onClick={() => props.setDelivery("estandar")} />
            {props.config.auxilioEnabled && (
              <RadioCard G={G} on={props.delivery === "auxilio"} title="Envío de Auxilio" sub="Hoy de 20:00 a 23:00 hs" price={money(props.config.auxilioCostMinor)} onClick={() => props.setDelivery("auxilio")} />
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Método de pago</div>
            <div style={{ fontSize: 12.5, color: C.mute, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", margin: "10px 0 8px" }}>Pagar al recibir</div>
            <RadioCard G={G} on={props.payment === "efectivo"} title="Efectivo" sub="Pagás en la puerta al recibir el pedido" onClick={() => props.setPayment("efectivo")} />
            <RadioCard G={G} on={props.payment === "transferencia"} title="Transferencia bancaria" sub={`${props.config.transferDiscountPercent}% de descuento`} onClick={() => props.setPayment("transferencia")} />
            <RadioCard G={G} on={props.payment === "pos"} title="Tarjeta (POS al recibir)" sub="Débito o crédito al momento de la entrega" onClick={() => props.setPayment("pos")} />
            <div style={{ fontSize: 12.5, color: C.mute, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", margin: "14px 0 8px" }}>Pagar ahora</div>
            <div style={{ display: "flex", gap: 13, alignItems: "center", padding: 14, borderRadius: 11, border: `1.5px solid ${C.border}`, background: C.surf, opacity: 0.7 }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${C.radioOff}`, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Mercado Pago</span>
                <span style={{ display: "block", fontSize: 12.5, color: C.mute }}>Débito, crédito o dinero en cuenta</span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: C.mute, background: C.white, borderRadius: 7, padding: "4px 8px" }}>Próximamente</span>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="sf-checkout-sum" style={{ position: "sticky", top: 96, background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
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
function DoneView({ G, tenant, orderId, totalMinor, petName, onHome }: { G: string; tenant: string; orderId: string; totalMinor: string; petName: string | null; onHome: () => void }) {
  const forPet = petName?.trim();
  const trackUrl = `/seguimiento/${orderId}?tenant=${encodeURIComponent(tenant)}`;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: 74, height: 74, borderRadius: "50%", background: C.iconBg, color: G, display: "grid", placeItems: "center", margin: "0 auto" }}><Check size={34} sw={2.6} /></div>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 24 }}>
        {forPet ? <>¡Listo! El pedido de {forPet} está confirmado</> : <>¡Pedido confirmado!</>}
      </h1>
      <p style={{ fontSize: 15.5, color: C.text2, lineHeight: 1.65 }}>Pedido <b>#{orderId.slice(0, 8)}</b> por <b>{money(totalMinor)}</b>. Te escribimos por WhatsApp para coordinar la entrega en Gualeguay.</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
        <a className="sf-btn" href={trackUrl} style={{ ...primaryBtn(G), padding: "14px 30px", textDecoration: "none" }}>SEGUIR MI PEDIDO</a>
        <button className="sf-btn" onClick={onHome} style={{ ...outlineBtn(G), padding: "14px 30px" }}>SEGUIR COMPRANDO</button>
      </div>
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
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>¿Cuánto le dura?</div>
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
const SPECIES_LABEL: Record<string, string> = { perro: "Perro", gato: "Gato", otro: "Mascota" };

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
                <Img src={a.imageUrl} alt={a.name} ratio="1" radius={0} seed={a.id} />
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
        <User size={22} strokeWidth={1.8} color={C.nav} aria-hidden />
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 34, background: "white", color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, width: 240, zIndex: 45, boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
          {email ? (
            <>
              <div style={{ fontSize: 13, color: C.mute, marginBottom: 8, wordBreak: "break-all" }}>{email}</div>
              <button onClick={() => { setModal("orders"); setOpen(false); }} style={{ ...primaryBtn(G), width: "100%", padding: 10, marginBottom: 6 }}>Mis pedidos</button>
              {showPets && <button onClick={() => { setModal("pets"); setOpen(false); }} style={{ ...outlineBtn(G), width: "100%", padding: 10, marginBottom: 6 }}><PawPrint size={15} strokeWidth={1.8} style={{verticalAlign:"-3px",marginRight:6}} />Mis mascotas</button>}
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
      <div className="sf-footer" style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 32 }}>
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
