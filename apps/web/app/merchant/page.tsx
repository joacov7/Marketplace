"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PawPrint, Bike, MapPin, Pencil, X, Plus, Package, Tags, BarChart3, Palette, Dog, Cat, RotateCcw, SlidersHorizontal, Clock,
  Megaphone, Sparkles, Copy, Download,
} from "lucide-react";
import { WEEKDAYS } from "@/lib/delivery-schedule";

/** Icono de especie con lucide (Dog / Cat / PawPrint). Nunca emoji. */
function PetSpeciesIcon({ species, size = 15 }: { species: string; size?: number }) {
  if (species === "perro") return <Dog size={size} strokeWidth={1.8} />;
  if (species === "gato") return <Cat size={size} strokeWidth={1.8} />;
  return <PawPrint size={size} strokeWidth={1.8} />;
}

interface Merchant { id: string; slug: string; name: string }
interface OrderLine { name: string; variant: string; qty: number }
interface SellerOrder { sellerOrderId: string; orderId: string; orderStatus: string; status: string; subtotalMinor: string; currency: string; itemCount: number; items: OrderLine[]; petName: string | null; customerName: string | null; customerPhone: string | null; paymentMethod: string | null; paymentStatus: string; channel: string; needsAcceptance: boolean; createdAt: string }
interface CatalogItem { variantId: string; productName: string; variantName: string; sku: string; imageUrl: string | null; categoryId: string | null; categoryName: string | null; description: string | null; kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null; priceMinor: string | null; listPriceMinor: string | null; currency: string | null; available: number; status: string }
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
  "storefront.heroImageUrl": string;
  "storefront.adoptionsBannerImageUrl": string;
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
const CHANNEL_LABEL: Record<string, string> = { web: "Web", whatsapp: "WhatsApp", telefono: "Teléfono", mostrador: "Mostrador" };
const METHOD_LABEL: Record<string, string> = { online: "Online", efectivo: "Efectivo", pos: "Tarjeta (POS)", transferencia: "Transferencia" };

// ── Design tokens del panel (identidad Pet Shop: verde de marca + neutros cálidos) ──
const A = "#2e7d32";        // accent (verde marca)
const A_DARK = "#256a2a";
const A_SOFT = "#e9f4ea";   // tinte del accent
const INK = "#1f2a2e";      // texto principal
const MUT = "#6b7280";      // texto secundario
const LINE = "#e7e9ec";     // bordes
const SURF = "#f4f6f5";     // fondo de página

const money = (minor: string | number, c = "ARS") => (Number(minor) / 100).toLocaleString("es-AR", { style: "currency", currency: c });
const btn: React.CSSProperties = { background: A, color: "white", border: "none", borderRadius: 10, padding: "9px 15px", fontWeight: 600, fontSize: 13.5, cursor: "pointer", boxShadow: "0 1px 2px rgba(46,125,50,.25)" };
const btnGhost: React.CSSProperties = { background: "white", color: INK, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 14px", fontWeight: 600, fontSize: 13.5, cursor: "pointer" };
const btnDanger: React.CSSProperties = { ...btnGhost, color: "#c0392b", borderColor: "#f0c9c4" };
const input: React.CSSProperties = { padding: "9px 11px", borderRadius: 10, border: `1px solid ${LINE}`, background: "white", fontSize: 14, color: INK, outline: "none" };
const card: React.CSSProperties = { background: "white", border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, boxShadow: "0 1px 2px rgba(16,24,40,.04)" };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: INK, margin: "0 0 12px" };
const PANEL_CSS = `
:root{color-scheme:light;}
.mbtn{transition:filter .15s ease, transform .05s ease, box-shadow .15s ease;}
.mbtn:hover{filter:brightness(1.04);}
.mbtn:active{transform:scale(.985);}
input,select,textarea{max-width:100%;font-family:inherit;}
input:focus,select:focus,textarea:focus{border-color:${A} !important;box-shadow:0 0 0 3px ${A_SOFT};}
.mcard{transition:box-shadow .18s ease;}
.mcard:hover{box-shadow:0 6px 20px rgba(16,24,40,.07);}
.mtab{border:none;cursor:pointer;font-weight:600;font-size:14px;padding:9px 16px;border-radius:9px;background:transparent;color:${MUT};transition:background .15s ease,color .15s ease;}
.mtab:hover{color:${INK};}
.mtab-on{background:white;color:${A};box-shadow:0 1px 3px rgba(16,24,40,.1);}
@media (max-width:560px){
  .mform-grid{grid-template-columns:1fr !important;}
}
@media (max-width:720px){
  .mcontent-grid{grid-template-columns:1fr !important;}
}
`;

export default function MerchantPanel() {
  const [tenant, setTenant] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [tab, setTab] = useState<"catalogo" | "pedidos" | "suscripciones" | "contenido" | "reportes" | "diseno" | "adopciones" | "config">("catalogo");
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
      <div style={{ background: `radial-gradient(1200px 500px at 50% -10%, ${A_SOFT}, ${SURF})`, minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: INK }}>
        <style>{PANEL_CSS}</style>
        <div style={{ ...card, maxWidth: 400, width: "100%", padding: 28, textAlign: "center", boxShadow: "0 12px 40px rgba(16,24,40,.10)" }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: A_SOFT, color: A, display: "grid", placeItems: "center", margin: "0 auto 14px" }}><PawPrint size={28} strokeWidth={1.8} /></div>
          <h1 style={{ fontSize: 22, margin: "0 0 4px", letterSpacing: "-.01em" }}>Panel del comercio</h1>
          <p style={{ color: MUT, fontSize: 13.5, marginTop: 0, lineHeight: 1.5 }}>Ingresá tu código de acceso para administrar la tienda.</p>
          <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveToken()} placeholder="Código de acceso" type="password" style={{ ...input, width: "100%", marginTop: 6, padding: 13, textAlign: "center" }} />
          <button onClick={saveToken} className="mbtn" style={{ ...btn, width: "100%", padding: 13, marginTop: 10 }}>Entrar</button>
        </div>
      </div>
    );
  }

  const TABS: Array<[typeof tab, typeof Tags, string]> = [
    ["catalogo", Tags, "Catálogo"], ["pedidos", Package, "Pedidos"], ["suscripciones", RotateCcw, "Suscripciones"],
    ["contenido", Megaphone, "Contenido"], ["reportes", BarChart3, "Reportes"], ["diseno", Palette, "Diseño"], ["adopciones", PawPrint, "Adopciones"],
    ["config", SlidersHorizontal, "Configuración"],
  ];

  return (
    <div style={{ background: SURF, minHeight: "100vh", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: INK }}>
      <style>{PANEL_CSS}</style>

      {/* Barra superior */}
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,.85)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${LINE}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "11px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: A_SOFT, color: A, display: "grid", placeItems: "center" }}><PawPrint size={18} strokeWidth={1.9} /></span>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
              <span style={{ fontSize: 10.5, color: MUT, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>Comercio</span>
              <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)} style={{ ...input, fontWeight: 700, padding: "5px 8px", border: "none", background: "transparent", fontSize: 15 }}>
                {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <button onClick={newMerchant} className="mbtn" style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5 }}>+ Comercio</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={`/reparto?tenant=${encodeURIComponent(tenant ?? "")}`} target="_blank" rel="noopener noreferrer" className="mbtn" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", color: A, borderColor: A_SOFT }} title="Pantalla del repartidor (se abre en otra pestaña; instalable en el celular)"><Bike size={16} strokeWidth={1.8} style={{marginRight:6}} />Reparto</a>
            <button onClick={runMigrate} disabled={migrating} className="mbtn" style={btnGhost} title="Aplica migraciones pendientes tras un deploy con cambios de esquema">
              {migrating ? "Migrando…" : "Migrar base"}
            </button>
            <button onClick={logout} className="mbtn" style={btnGhost}>Salir</button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "18px 16px 48px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#eceeef", padding: 5, borderRadius: 12, width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
        {TABS.map(([t, Ico, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`mbtn mtab${tab === t ? " mtab-on" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <Ico size={16} strokeWidth={1.9} />{label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...card, padding: "10px 14px", marginBottom: 14, borderColor: error.startsWith("✓") ? "#bfe3c4" : "#f0c9c4", background: error.startsWith("✓") ? A_SOFT : "#fdecea", color: error.startsWith("✓") ? A_DARK : "#b3261e", fontWeight: 600, fontSize: 13.5 }}>
          {error.startsWith("✓") ? error : `Error: ${error}`}
        </div>
      )}

      {tab === "catalogo" ? <CatalogTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : tab === "pedidos" ? <OrdersTab tenant={tenant} token={token} merchantId={merchantId} onError={setError} />
        : tab === "suscripciones" ? <SubscriptionsTab tenant={tenant} token={token} onError={setError} />
        : tab === "contenido" ? <ContentStudioTab tenant={tenant} token={token} onError={setError} />
        : tab === "reportes" ? <ReportsTab tenant={tenant} token={token} onError={setError} />
        : tab === "diseno" ? <DesignTab tenant={tenant} token={token} onError={setError} />
        : tab === "config" ? <><SettingsTab tenant={tenant} token={token} onError={setError} /><div style={{ height: 14 }} /><DeliveryScheduleEditor tenant={tenant} token={token} onError={setError} /></>
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

  async function save(variantId: string, priceMinor: number | null, listPriceMinor: number | null, stock: number, imageUrl: string, categoryId: string, description: string, food: { kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null }) {
    await fetch(`/api/merchant/catalog/${variantId}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ ...(priceMinor !== null ? { priceMinor } : {}), listPriceMinor, stock, imageUrl, categoryId, description, ...food }),
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
                <button onClick={() => renameCategory(c.id, c.name)} title="Renombrar" style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 2px", display: "inline-flex" }}><Pencil size={13} strokeWidth={1.9} /></button>
                <button onClick={() => removeCategory(c.id, c.name)} title="Borrar" style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 2px", color: "#c62828", display: "inline-flex" }}><X size={13} strokeWidth={2} /></button>
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

function CatalogRow({ it, cats, onSave }: { it: CatalogItem; cats: Category[]; onSave: (variantId: string, priceMinor: number | null, listPriceMinor: number | null, stock: number, imageUrl: string, categoryId: string, description: string, food: { kcalPerKg: number | null; proteinPct: number | null; netWeightKg: number | null }) => void }) {
  const [price, setPrice] = useState(it.priceMinor ? String(Number(it.priceMinor) / 100) : "");
  const [listPrice, setListPrice] = useState(it.listPriceMinor ? String(Number(it.listPriceMinor) / 100) : "");
  const [stock, setStock] = useState(String(it.available));
  const [imageUrl, setImageUrl] = useState(it.imageUrl ?? "");
  const [categoryId, setCategoryId] = useState(it.categoryId ?? "");
  const [description, setDescription] = useState(it.description ?? "");
  const [kcal, setKcal] = useState(it.kcalPerKg != null ? String(it.kcalPerKg) : "");
  const [protein, setProtein] = useState(it.proteinPct != null ? String(it.proteinPct) : "");
  const [netKg, setNetKg] = useState(it.netWeightKg != null ? String(it.netWeightKg) : "");
  const [openDesc, setOpenDesc] = useState(false);
  const numN = (s: string): number | null => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; };
  const doSave = () => onSave(it.variantId, price ? Math.round(Number(price) * 100) : null, listPrice ? Math.round(Number(listPrice) * 100) : null, Number(stock), imageUrl.trim(), categoryId, description.trim(), { kcalPerKg: numN(kcal), proteinPct: numN(protein), netWeightKg: numN(netKg) });
  return (
    <li style={{ ...card, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {it.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={it.imageUrl} alt={it.productName} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }} />
            : <span style={{ width: 40, height: 40, borderRadius: 6, background: "#f2f2f2", color: "#9aa2ab", display: "grid", placeItems: "center" }}><Package size={18} strokeWidth={1.7} /></span>}
          <span><strong>{it.productName}</strong> <span style={{ color: "#999", fontSize: 13 }}>{it.variantName} · {it.sku}</span></span>
        </span>
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#777" }}>$ <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ ...input, width: 90 }} /></label>
          <label style={{ fontSize: 12, color: "#777" }} title="Precio anterior (oferta). Vacío = sin oferta.">antes $ <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="—" style={{ ...input, width: 80 }} /></label>
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
            <span style={{ fontSize: 12, color: "#777" }}>Alimento:</span>
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
  const [pin, setPin] = useState("");
  const [pinSaved, setPinSaved] = useState<string | null>(null);
  const auth = { authorization: `Bearer ${token}` };

  // PIN de reparto (config del tenant): el cadete entra con esto, no con el token de admin.
  useEffect(() => {
    if (!tenant) return;
    fetch(`/api/merchant/delivery-pin?tenant=${encodeURIComponent(tenant)}`, { headers: auth })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setPin(d.pin ?? ""); setPinSaved(d.pin ?? ""); } })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);

  async function savePin() {
    const res = await fetch(`/api/merchant/delivery-pin?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ pin }),
    });
    const d = await res.json();
    if (!res.ok) { onError(d.error ?? "error"); return; }
    setPinSaved(d.pin ?? "");
  }

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
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={() => setShowNew(true)} className="mbtn" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2} />Nuevo pedido</button>
        <button onClick={load} className="mbtn" style={btnGhost}>{loading ? "…" : "Actualizar"}</button>
      </div>

      {/* PIN de reparto: lo usa el cadete para entrar a /reparto (sin el token del panel). */}
      <div style={{ ...card, marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><Bike size={16} strokeWidth={1.8} />PIN de reparto:</span>
        <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="ej: 2468" maxLength={32}
          style={{ ...input, width: 130 }} />
        <button onClick={savePin} className="mbtn" style={btn} disabled={pin === pinSaved}>Guardar</button>
        <span style={{ fontSize: 12.5, color: "#6b7280" }}>
          {pinSaved ? "El cadete entra a Reparto con este PIN." : "Sin PIN: reparto solo abre con el token de admin."}
        </span>
      </div>

      <DeliveryZonesBar tenant={tenant} token={token} onError={onError} />
      <DeliveryRadiusBar tenant={tenant} token={token} onError={onError} />


      {showNew && (
        <ManualOrderForm tenant={tenant} token={token} merchantId={merchantId} onError={onError}
          onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void load(); }} />
      )}

      {/* Nota de preparación del día: suma todo lo que hay que preparar (pedidos aceptados en curso). */}
      <PrepNote orders={active.filter((o) => o.status === "pending" || o.status === "preparing")} />

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
                  <button onClick={() => decide(o.orderId, "rechazar")} className="mbtn" style={btnDanger}>Rechazar</button>
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

/**
 * Nota de preparación del día: consolida en una sola lista TODO lo que hay que preparar
 * (suma cantidades por producto de los pedidos aceptados en curso), para agarrar todo de una
 * pasada antes de cargar la camioneta. Botón "Imprimir" abre una ventana limpia y la imprime.
 */
function PrepNote({ orders }: { orders: SellerOrder[] }) {
  const [open, setOpen] = useState(true);
  const agg = new Map<string, number>();
  for (const o of orders) for (const it of o.items ?? []) {
    const label = `${it.name}${it.variant && it.variant !== "Único" ? ` · ${it.variant}` : ""}`;
    agg.set(label, (agg.get(label) ?? 0) + it.qty);
  }
  const list = [...agg.entries()].map(([label, qty]) => ({ label, qty })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  if (list.length === 0) return null;

  function printNote() {
    const w = window.open("", "_blank", "width=460,height=640");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
    const rows = list.map((p) => `<tr><td style="font-weight:700;padding:6px 12px 6px 0;white-space:nowrap;vertical-align:top">${p.qty}×</td><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(p.label)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Nota de preparación</title></head><body style="font-family:system-ui,-apple-system,sans-serif;color:#1f2a2e;padding:24px;max-width:420px;margin:0 auto">
      <h2 style="margin:0 0 2px">Nota de preparación</h2>
      <div style="color:#6b7280;font-size:13px;margin-bottom:16px">${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })} · ${orders.length} pedido(s)</div>
      <table style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  return (
    <div style={{ ...card, marginBottom: 18, borderColor: "#bfe3c4", background: A_SOFT }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setOpen((v) => !v)} className="mbtn" style={{ background: "transparent", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 700, color: A_DARK, padding: 0 }}>
          <Package size={17} strokeWidth={1.9} /> Nota de preparación · {orders.length} pedido(s) {open ? "▾" : "▸"}
        </button>
        <button onClick={printNote} className="mbtn" style={{ ...btnGhost, padding: "6px 12px", fontSize: 12.5 }}>Imprimir</button>
      </div>
      {open && (
        <div style={{ marginTop: 12, background: "white", borderRadius: 10, padding: "6px 14px" }}>
          {list.map((p) => (
            <div key={p.label} style={{ display: "flex", gap: 12, fontSize: 14, padding: "7px 0", borderBottom: `1px solid ${LINE}` }}>
              <span style={{ fontWeight: 700, minWidth: 36, color: A_DARK }}>{p.qty}×</span>
              <span style={{ color: INK }}>{p.label}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: MUT, paddingTop: 8 }}>Suma de los pedidos aceptados en preparación.</div>
        </div>
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
        {o.items && o.items.length > 0 && (
          <div style={{ marginTop: 8, background: "#f7f9f8", border: `1px solid ${LINE}`, borderRadius: 8, padding: "8px 11px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Preparar</div>
            {o.items.map((it, i) => (
              <div key={i} style={{ fontSize: 13, color: INK, padding: "1px 0" }}><b>{it.qty}×</b> {it.name}{it.variant && it.variant !== "Único" ? ` · ${it.variant}` : ""}</div>
            ))}
          </div>
        )}
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
type Zone = { id: string; name: string; customerChargeMinor: string; etaMinutes: number | null };

/**
 * Zonas de reparto: costo (y tiempo) por barrio. Cuando hay zonas, en el checkout el cliente
 * elige su zona y el envío toma ese costo (en vez del plano). Editable acá.
 */
function DeliveryZonesBar({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const auth = { authorization: `Bearer ${token}` };
  const [zones, setZones] = useState<Zone[]>([]);
  const [open, setOpen] = useState(false);
  const [nf, setNf] = useState({ name: "", price: "", eta: "" });

  const load = useCallback(async () => {
    if (!tenant) return;
    const res = await fetch(`/api/merchant/zones?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    if (res.ok) setZones((await res.json()).zones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!nf.name.trim()) return;
    const res = await fetch(`/api/merchant/zones?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name: nf.name.trim(), customerChargeMinor: Math.round(Number(nf.price || 0) * 100), etaMinutes: Number(nf.eta) || undefined }),
    });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    setNf({ name: "", price: "", eta: "" });
    await load();
  }
  async function saveZone(z: Zone, price: string, eta: string) {
    const res = await fetch(`/api/merchant/zones/${z.id}?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ customerChargeMinor: Math.round(Number(price || 0) * 100), etaMinutes: eta ? Number(eta) : null }),
    });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    await load();
  }
  async function del(z: Zone) {
    if (!confirm(`¿Eliminar la zona "${z.name}"?`)) return;
    const res = await fetch(`/api/merchant/zones/${z.id}?tenant=${encodeURIComponent(tenant ?? "")}`, { method: "DELETE", headers: auth });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    await load();
  }

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}><MapPin size={15} strokeWidth={1.8} />Zonas de reparto {zones.length > 0 && <span style={{ color: MUT, fontWeight: 400 }}>({zones.length})</span>}</span>
        <span style={{ color: MUT }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <p style={{ fontSize: 12.5, color: MUT, margin: 0 }}>Con zonas cargadas, el cliente elige su barrio en el checkout y el envío toma ese costo. Sin zonas, se usa el envío plano de config.</p>
          {zones.map((z) => <ZoneRow key={z.id} z={z} onSave={saveZone} onDelete={del} />)}
          <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "center", borderTop: `1px dashed ${LINE}`, paddingTop: 10 }}>
            <input placeholder="Barrio / zona" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} style={input} />
            <input placeholder="Costo $" inputMode="decimal" value={nf.price} onChange={(e) => setNf({ ...nf, price: e.target.value.replace(/[^0-9.]/g, "") })} style={input} />
            <input placeholder="Min (ETA)" inputMode="numeric" value={nf.eta} onChange={(e) => setNf({ ...nf, eta: e.target.value.replace(/[^0-9]/g, "") })} style={input} />
            <button onClick={add} className="mbtn" style={btn}>Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}
function ZoneRow({ z, onSave, onDelete }: { z: Zone; onSave: (z: Zone, price: string, eta: string) => void; onDelete: (z: Zone) => void }) {
  const [price, setPrice] = useState(String(Number(z.customerChargeMinor) / 100));
  const [eta, setEta] = useState(z.etaMinutes != null ? String(z.etaMinutes) : "");
  const dirty = Math.round(Number(price || 0) * 100) !== Number(z.customerChargeMinor) || (eta ? Number(eta) : null) !== z.etaMinutes;
  return (
    <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{z.name}</span>
      <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} style={input} title="Costo al cliente" />
      <input value={eta} onChange={(e) => setEta(e.target.value.replace(/[^0-9]/g, ""))} placeholder="min" style={input} title="Tiempo estimado" />
      <span style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onSave(z, price, eta)} className="mbtn" style={{ ...btn, opacity: dirty ? 1 : 0.5 }} disabled={!dirty}>✓</button>
        <button onClick={() => onDelete(z)} className="mbtn" style={{ ...btnDanger, display: "inline-flex", alignItems: "center" }} aria-label="Eliminar"><X size={15} strokeWidth={2} /></button>
      </span>
    </div>
  );
}

/**
 * Radio de reparto (geocerca): límite de distancia desde el local. Complementa a las zonas por
 * barrio. Si está activo (radio > 0) y el cliente comparte su ubicación en el checkout, se
 * rechazan los pedidos fuera del radio. Todo por config del tenant.
 */
function DeliveryRadiusBar({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const auth = { authorization: `Bearer ${token}` };
  const [open, setOpen] = useState(false);
  const [radius, setRadius] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saved, setSaved] = useState({ radius: "", lat: "", lng: "" });
  const [geoBusy, setGeoBusy] = useState(false);
  const [okMsg, setOkMsg] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const res = await fetch(`/api/merchant/delivery-radius?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    if (!res.ok) return;
    const d = await res.json();
    const r = String(d["delivery.radiusKm"] ?? 0);
    const la = String(d["delivery.centerLat"] ?? 0);
    const ln = String(d["delivery.centerLng"] ?? 0);
    setRadius(r === "0" ? "" : r); setLat(la === "0" ? "" : la); setLng(ln === "0" ? "" : ln);
    setSaved({ radius: r, lat: la, lng: ln });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { onError("Tu navegador no permite compartir ubicación."); return; }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setGeoBusy(false); },
      () => { onError("No se pudo obtener la ubicación."); setGeoBusy(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const dirty =
    String(Number(radius || 0)) !== String(Number(saved.radius || 0)) ||
    String(Number(lat || 0)) !== String(Number(saved.lat || 0)) ||
    String(Number(lng || 0)) !== String(Number(saved.lng || 0));

  async function save() {
    setOkMsg(false);
    const res = await fetch(`/api/merchant/delivery-radius?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        "delivery.radiusKm": Number(radius || 0),
        "delivery.centerLat": Number(lat || 0),
        "delivery.centerLng": Number(lng || 0),
      }),
    });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    onError(null);
    setSaved({ radius: String(Number(radius || 0)), lat: String(Number(lat || 0)), lng: String(Number(lng || 0)) });
    setOkMsg(true);
  }

  const active = Number(saved.radius || 0) > 0 && (Number(saved.lat || 0) !== 0 || Number(saved.lng || 0) !== 0);

  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <MapPin size={15} strokeWidth={1.8} />Radio de reparto {active && <span style={{ color: "#2e7d32", fontWeight: 600 }}>· hasta {Number(saved.radius)} km</span>}
        </span>
        <span style={{ color: MUT }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <p style={{ fontSize: 12.5, color: MUT, margin: 0 }}>
            Con un radio cargado, si el cliente comparte su ubicación en el checkout y queda fuera del radio, el pedido se rechaza. Dejá el radio en blanco (o 0) para no limitar por distancia.
          </p>
          <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 12, color: MUT }}>Radio (km)
              <input placeholder="ej: 8" inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...input, width: "100%", boxSizing: "border-box", marginTop: 3 }} />
            </label>
            <label style={{ fontSize: 12, color: MUT }}>Latitud del local
              <input placeholder="-33.146" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value.replace(/[^0-9.\-]/g, ""))} style={{ ...input, width: "100%", boxSizing: "border-box", marginTop: 3 }} />
            </label>
            <label style={{ fontSize: 12, color: MUT }}>Longitud del local
              <input placeholder="-59.309" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value.replace(/[^0-9.\-]/g, ""))} style={{ ...input, width: "100%", boxSizing: "border-box", marginTop: 3 }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={useMyLocation} disabled={geoBusy} className="mbtn" style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <MapPin size={14} strokeWidth={1.9} />{geoBusy ? "Obteniendo…" : "Usar mi ubicación actual"}
            </button>
            <span style={{ fontSize: 11.5, color: MUT }}>Parate en el local y tocá el botón para fijar el centro.</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={save} className="mbtn" style={{ ...btn, opacity: dirty ? 1 : 0.5 }} disabled={!dirty}>Guardar</button>
            {okMsg && !dirty && <span style={{ fontSize: 12.5, color: "#2e7d32", fontWeight: 600 }}>Guardado ✓</span>}
          </div>
        </div>
      )}
    </div>
  );
}

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
        <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input style={input} placeholder="Teléfono / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input style={input} placeholder="Nombre del cliente" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        {greetName && <div style={{ fontSize: 12.5, color: "#2e7d32", fontWeight: 600, marginTop: 6 }}>Cliente conocido: {greetName}</div>}

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
                  <PetSpeciesIcon species={p.species} /> {p.name}
                </button>
              );
            })}
            <button type="button" onClick={() => setPetSel("")} style={{ padding: "7px 12px", borderRadius: 999, cursor: "pointer", border: `1.5px dashed ${addingNew ? "#2e7d32" : "#d4d6dc"}`, background: "white", fontSize: 13, fontWeight: 600, color: "#5b6270", display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={14} strokeWidth={2} />Mascota</button>
          </div>
        )}
        {addingNew && (
          <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8 }}>
            <input style={input} placeholder="Nombre (ej: Bruno)" value={newPet.name} onChange={(e) => setNewPet({ ...newPet, name: e.target.value })} />
            <select style={input} value={newPet.species} onChange={(e) => setNewPet({ ...newPet, species: e.target.value })}>
              <option value="perro">Perro</option><option value="gato">Gato</option><option value="otro">Otro</option>
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
        <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <input style={input} placeholder="Calle y número" value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} />
          <input style={input} placeholder="Barrio / zona" value={addr.zone} onChange={(e) => setAddr({ ...addr, zone: e.target.value })} />
        </div>

        {/* 5 y 6. Pago + canal */}
        <label style={lbl}>5 · Pago y canal</label>
        <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <select style={input} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="pos">Tarjeta (POS)</option>
          </select>
          <select style={input} value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>
            <option value="pendiente">Pago pendiente</option><option value="pagado">Ya pagó</option>
          </select>
          <select style={input} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option><option value="telefono">Teléfono</option><option value="mostrador">Mostrador</option>
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
    <div className="mcard" style={{ ...card, minWidth: 150, flex: 1 }}>
      <div style={{ fontSize: 12, color: MUT, marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-.02em", color: accent ?? INK }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "#9aa2ab", marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

interface SubRow {
  id: string; status: "active" | "paused" | "cancelled"; qty: number; intervalDays: number; nextRunAt: string;
  petName: string | null; variantName: string; productName: string; paymentMethod: string; discountPercent: number;
  customerName: string | null; customerPhone: string | null; lastRunAt: string | null; lastError: string | null;
}

// ── Configuración: parámetros de negocio (registry-driven) ──────────────────────────
type SettingsField = {
  key: string; label: string; help: string;
  type: "boolean" | "money" | "integer" | "select" | "text";
  options?: unknown[]; min?: number; max?: number; value: unknown;
};
type SettingsSection = { title: string; fields: SettingsField[] };
const SUBSIDY_LABELS: Record<string, string> = {
  platform: "La plataforma", merchant: "El comercio", promo: "Una promoción", none: "Nadie (sin subsidio)",
};
function optionLabel(key: string, o: unknown): string {
  if (key === "delivery.subsidySource") return SUBSIDY_LABELS[String(o)] ?? String(o);
  return String(o);
}
function fieldToInput(f: SettingsField): string | boolean {
  if (f.type === "boolean") return f.value === true;
  if (f.type === "money") return String((Number(f.value) || 0) / 100);
  return String(f.value ?? "");
}

/**
 * Editor de parámetros del negocio: costos de envío, umbral de envío gratis, descuentos, etc.
 * Los campos y sus tipos salen del backend (registry de config); el comercio los cambia sin
 * tocar código ni variables de entorno. Guardar escribe overrides a nivel tenant.
 */
function SettingsTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const auth = { authorization: `Bearer ${token}` };
  const [sections, setSections] = useState<SettingsSection[]>([]);
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [init, setInit] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const res = await fetch(`/api/merchant/settings?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    const d = await res.json();
    const secs: SettingsSection[] = d.sections ?? [];
    const v: Record<string, string | boolean> = {};
    for (const s of secs) for (const f of s.fields) v[f.key] = fieldToInput(f);
    setSections(secs); setVals(v); setInit({ ...v });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  const fields = sections.flatMap((s) => s.fields);
  const dirtyKeys = fields.filter((f) => vals[f.key] !== init[f.key]).map((f) => f.key);

  async function save() {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    onError(null);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (vals[f.key] === init[f.key]) continue;
      const raw = vals[f.key];
      if (f.type === "boolean") out[f.key] = raw === true;
      else if (f.type === "money") out[f.key] = Math.round((Number(raw) || 0) * 100);
      else if (f.type === "integer") out[f.key] = Math.round(Number(raw) || 0);
      else if (f.type === "select") out[f.key] = f.options?.every((o) => typeof o === "number") ? Number(raw) : raw;
      else out[f.key] = raw;
    }
    const res = await fetch(`/api/merchant/settings?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(out),
    });
    setSaving(false);
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    await load();
    onError("✓ Configuración guardada.");
  }

  function setVal(key: string, v: string | boolean) { setVals((s) => ({ ...s, [key]: v })); }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ fontSize: 13, color: MUT, margin: 0 }}>
        Cambiá los parámetros del negocio sin tocar código. Los montos van en pesos. Los cambios se aplican a tu tienda al guardar.
      </p>
      {sections.map((s) => (
        <div key={s.title} style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: INK }}>{s.title}</div>
          <div style={{ display: "grid", gap: 14 }}>
            {s.fields.map((f) => (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{f.label}</div>
                  <div style={{ fontSize: 11.5, color: MUT, marginTop: 2 }}>{f.help}</div>
                </div>
                <div style={{ justifySelf: "end", minWidth: 140 }}>
                  {f.type === "boolean" ? (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: vals[f.key] === true ? A_DARK : MUT }}>
                      <input type="checkbox" checked={vals[f.key] === true} onChange={(e) => setVal(f.key, e.target.checked)} style={{ width: 16, height: 16 }} />
                      {vals[f.key] === true ? "Activado" : "Desactivado"}
                    </label>
                  ) : f.type === "select" ? (
                    <select value={String(vals[f.key] ?? "")} onChange={(e) => setVal(f.key, e.target.value)} style={{ ...input, width: 180 }}>
                      {f.options?.map((o) => <option key={String(o)} value={String(o)}>{optionLabel(f.key, o)}</option>)}
                    </select>
                  ) : (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {f.type === "money" && <span style={{ color: MUT, fontSize: 14 }}>$</span>}
                      <input
                        inputMode="decimal"
                        value={String(vals[f.key] ?? "")}
                        onChange={(e) => setVal(f.key, e.target.value.replace(/[^0-9.]/g, ""))}
                        style={{ ...input, width: 130, textAlign: "right" }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={save} className="mbtn" style={{ ...btn, opacity: dirtyKeys.length && !saving ? 1 : 0.5 }} disabled={!dirtyKeys.length || saving}>
          {saving ? "Guardando…" : `Guardar cambios${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
        </button>
        {dirtyKeys.length > 0 && !saving && <span style={{ fontSize: 12.5, color: MUT }}>Hay cambios sin guardar.</span>}
      </div>
    </div>
  );
}

type Slot = { label: string; from: string; to: string };
/**
 * Editor de la agenda de entrega: turnos que el cliente puede elegir, días en que el comercio
 * reparte, hora de corte (hoy vs próximo día) y franja del Envío de Auxilio. Config por tenant.
 */
function DeliveryScheduleEditor({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const auth = { authorization: `Bearer ${token}` };
  const [slots, setSlots] = useState<Slot[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [cutoff, setCutoff] = useState("18");
  const [auxilio, setAuxilio] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    const res = await fetch(`/api/merchant/delivery-schedule?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    const d = await res.json();
    setSlots(Array.isArray(d["delivery.slots"]) ? d["delivery.slots"] : []);
    setDays(Array.isArray(d["delivery.days"]) ? d["delivery.days"].map(Number) : [1, 2, 3, 4, 5, 6]);
    setCutoff(String(d["delivery.cutoffHour"] ?? 18));
    setAuxilio(String(d["delivery.auxilioWindow"] ?? ""));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  const toggleDay = (n: number) => setDays((ds) => (ds.includes(n) ? ds.filter((x) => x !== n) : [...ds, n]));
  const setSlot = (i: number, patch: Partial<Slot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addSlot = () => setSlots((s) => [...s, { label: "", from: "09:00", to: "13:00" }]);
  const delSlot = (i: number) => setSlots((s) => s.filter((_, j) => j !== i));

  async function save() {
    // Validación mínima antes de mandar: turnos con nombre y horas, al menos un día.
    const clean = slots.map((s) => ({ label: s.label.trim(), from: s.from, to: s.to })).filter((s) => s.label && /^\d{2}:\d{2}$/.test(s.from) && /^\d{2}:\d{2}$/.test(s.to));
    if (days.length === 0) { onError("Elegí al menos un día de reparto."); return; }
    setSaving(true);
    onError(null);
    const res = await fetch(`/api/merchant/delivery-schedule?tenant=${encodeURIComponent(tenant ?? "")}`, {
      method: "PATCH", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        "delivery.slots": clean,
        "delivery.days": days,
        "delivery.cutoffHour": Math.max(0, Math.min(23, Math.round(Number(cutoff) || 0))),
        "delivery.auxilioWindow": auxilio.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) { onError((await res.json()).error ?? "error"); return; }
    await load();
    onError("✓ Horarios de entrega guardados.");
  }

  if (!loaded) return <div style={card}>Cargando horarios…</div>;
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: INK, display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Clock size={16} strokeWidth={1.9} /> Horarios de entrega
      </div>
      <p style={{ fontSize: 12, color: MUT, margin: "0 0 14px" }}>Definí los turnos que el cliente puede elegir, los días en que repartís y hasta qué hora tomás pedidos para el mismo día.</p>

      {/* Turnos */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Turnos que puede elegir el cliente</div>
      <div style={{ display: "grid", gap: 8 }}>
        {slots.map((s, i) => (
          <div key={i} className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
            <input placeholder="Nombre (ej: Mañana)" value={s.label} onChange={(e) => setSlot(i, { label: e.target.value })} style={input} />
            <input type="time" value={s.from} onChange={(e) => setSlot(i, { from: e.target.value })} style={input} />
            <input type="time" value={s.to} onChange={(e) => setSlot(i, { to: e.target.value })} style={input} />
            <button onClick={() => delSlot(i)} className="mbtn" style={{ ...btnDanger, display: "inline-flex", alignItems: "center" }} aria-label="Quitar turno"><X size={15} strokeWidth={2} /></button>
          </div>
        ))}
        {slots.length === 0 && <p style={{ fontSize: 12, color: MUT, margin: 0 }}>Sin turnos: el cliente solo elige el día.</p>}
        <button onClick={addSlot} className="mbtn" style={{ ...btnGhost, justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={15} strokeWidth={2} /> Agregar turno</button>
      </div>

      {/* Días */}
      <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: "16px 0 8px" }}>Días que repartís</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {WEEKDAYS.map(({ n, label }) => {
          const on = days.includes(n);
          return (
            <button key={n} type="button" onClick={() => toggleDay(n)}
              style={{ padding: "8px 13px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${on ? A : LINE}`, background: on ? A_SOFT : "white", fontSize: 13, fontWeight: 600, color: on ? A_DARK : MUT }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Corte + auxilio */}
      <div className="mform-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: MUT, marginBottom: 3 }}>Hora de corte (0-23)</div>
          <input inputMode="numeric" value={cutoff} onChange={(e) => setCutoff(e.target.value.replace(/[^0-9]/g, ""))} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, color: MUT, marginTop: 3 }}>Después de esta hora, los pedidos pasan al próximo día de reparto.</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: MUT, marginBottom: 3 }}>Franja del Envío de Auxilio</div>
          <input value={auxilio} onChange={(e) => setAuxilio(e.target.value)} placeholder="20:00 a 23:00" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, color: MUT, marginTop: 3 }}>Texto que ve el cliente en el envío urgente/nocturno.</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={save} disabled={saving} className="mbtn" style={btn}>{saving ? "Guardando…" : "Guardar horarios"}</button>
      </div>
    </div>
  );
}

interface ContentThemeOpt { value: string; label: string }
/**
 * Estudio de Contenido: el agente arma la publicación del día (texto + placa) con datos reales
 * del catálogo y el calendario de temas del comercio. El comercio revisa, edita, copia el texto
 * y descarga la placa para subirla a sus redes. Publicación manual por ahora (sin API de Meta).
 */
function ContentStudioTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const auth = { authorization: `Bearer ${token}` };
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [selTheme, setSelTheme] = useState<string | null>(null);
  const [variant, setVariant] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [themeLabel, setThemeLabel] = useState("");
  const [themes, setThemes] = useState<ContentThemeOpt[]>([]);
  const [variantIdx, setVariantIdx] = useState(0);
  const [variantCount, setVariantCount] = useState(0);
  const [placaBase, setPlacaBase] = useState("");
  const [productCount, setProductCount] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    const p = new URLSearchParams({ tenant, date });
    if (selTheme) p.set("theme", selTheme);
    if (variant !== null) p.set("variant", String(variant));
    try {
      const res = await fetch(`/api/merchant/content/today?${p.toString()}`, { headers: auth });
      const d = await res.json();
      if (!res.ok) { onError(d.error ?? "error"); return; }
      setTitle(d.post.title);
      setBody(d.post.body);
      setHashtags((d.post.hashtags ?? []).join(" "));
      setThemeLabel(d.post.themeLabel);
      setVariantIdx(d.post.variant);
      setVariantCount(d.post.variantCount);
      setPlacaBase(d.placaUrl);
      setThemes(d.themes ?? []);
      setEnabled(d.enabled !== false);
      setProductCount(d.productCount ?? 0);
      setSelTheme(d.post.theme);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token, date, selTheme, variant]);
  useEffect(() => { void load(); }, [load]);

  // Normaliza los hashtags escritos (espacios/comas) para el texto a copiar.
  const tags = hashtags.split(/[\s,]+/).map((h) => h.trim().replace(/^#+/, "")).filter(Boolean).map((h) => `#${h}`);
  const fullText = [title.trim(), body.trim(), tags.join(" ")].filter(Boolean).join("\n\n");

  // La placa refleja lo que el comercio edita (título/cuerpo); el resto (marca, tema, precio)
  // viene del servidor en placaBase.
  const previewUrl = (() => {
    if (!placaBase) return "";
    try {
      const u = new URL(placaBase, window.location.origin);
      u.searchParams.set("title", title);
      u.searchParams.set("body", body);
      return `${u.pathname}?${u.searchParams.toString()}`;
    } catch { return placaBase; }
  })();

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullText);
      onError("✓ Texto copiado. Pegalo en tu publicación de Instagram o Facebook.");
    } catch {
      onError("No pude copiar automáticamente. Seleccioná el texto y copialo a mano.");
    }
  }

  function pickTheme(t: string) { setVariant(null); setSelTheme(t); }
  function nextVariant() { if (variantCount > 1) setVariant(variantIdx + 1); }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={17} strokeWidth={1.9} /> Publicación del día
        </div>
        <p style={{ fontSize: 12.5, color: MUT, margin: "6px 0 0" }}>
          El agente arma el post con tus productos y el tema del día. Revisalo, editá lo que quieras, copiá el texto y descargá la placa para subirla a tus redes.
        </p>
        {!enabled && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#b3261e", background: "#fdecea", border: "1px solid #f0c9c4", borderRadius: 10, padding: "8px 12px" }}>
            El Estudio de Contenido está desactivado. Activalo en <b>Configuración → Funciones de la tienda</b>.
          </div>
        )}
        {enabled && productCount === 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: A_DARK, background: A_SOFT, borderRadius: 10, padding: "8px 12px" }}>
            No hay productos en stock: los temas de producto/oferta usan un texto genérico hasta que cargues catálogo.
          </div>
        )}

        {/* Tema + fecha + variante */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, alignItems: "center" }}>
          {themes.map((t) => {
            const on = selTheme === t.value;
            return (
              <button key={t.value} type="button" onClick={() => pickTheme(t.value)}
                style={{ padding: "7px 13px", borderRadius: 999, cursor: "pointer", border: `1.5px solid ${on ? A : LINE}`, background: on ? A_SOFT : "white", fontSize: 12.5, fontWeight: 700, color: on ? A_DARK : MUT }}>
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: MUT, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Fecha
            <input type="date" value={date} onChange={(e) => { setVariant(null); setDate(e.target.value); }} style={{ ...input, padding: "7px 9px" }} />
          </label>
          <button onClick={nextVariant} disabled={variantCount <= 1 || loading} className="mbtn" style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6, opacity: variantCount <= 1 ? 0.5 : 1 }}>
            <RotateCcw size={14} strokeWidth={2} /> Otra variante {variantCount > 1 ? `(${variantIdx + 1}/${variantCount})` : ""}
          </button>
          {loading && <span style={{ fontSize: 12, color: MUT }}>Generando…</span>}
        </div>
      </div>

      {/* Editor + placa */}
      <div className="mcontent-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignItems: "start" }}>
        <div style={card}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8 }}>Texto de la publicación</div>
          <div style={{ fontSize: 11, color: MUT, marginBottom: 3 }}>Título</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box", fontWeight: 700 }} />
          <div style={{ fontSize: 11, color: MUT, margin: "10px 0 3px" }}>Cuerpo</div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} style={{ ...input, width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: 1.4 }} />
          <div style={{ fontSize: 11, color: MUT, margin: "10px 0 3px" }}>Hashtags</div>
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="mascotas petshop" style={{ ...input, width: "100%", boxSizing: "border-box", color: A_DARK }} />
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={copy} className="mbtn" style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 7 }}><Copy size={15} strokeWidth={2} /> Copiar texto</button>
            {previewUrl && (
              <a href={previewUrl} download={`placa-${date}-${selTheme ?? "post"}.png`} className="mbtn" style={{ ...btnGhost, textDecoration: "none", color: INK, display: "inline-flex", alignItems: "center", gap: 7 }}>
                <Download size={15} strokeWidth={2} /> Descargar placa
              </a>
            )}
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span>Placa {themeLabel ? `· ${themeLabel}` : ""}</span>
            <span style={{ fontSize: 11, color: MUT, fontWeight: 500 }}>1080×1080</span>
          </div>
          <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: SURF }}>
            {previewUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img key={previewUrl} src={previewUrl} alt="Placa de la publicación" style={{ display: "block", width: "100%", aspectRatio: "1 / 1" }} />
              : <div style={{ aspectRatio: "1 / 1", display: "grid", placeItems: "center", color: MUT, fontSize: 13 }}>{loaded ? "Sin placa" : "Cargando…"}</div>}
          </div>
          <p style={{ fontSize: 11, color: MUT, margin: "8px 0 0" }}>La placa se actualiza con lo que editás arriba. Cuando conectemos la API de Instagram/Facebook, esto se publicará solo.</p>
        </div>
      </div>
    </div>
  );
}

function SubscriptionsTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const auth = { authorization: `Bearer ${token}` };
  const fmt = (iso: string | null) => { if (!iso) return "—"; try { return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" }); } catch { return "—"; } };

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/subscriptions?tenant=${encodeURIComponent(tenant)}`, { headers: auth });
      const d = await res.json();
      setLoading(false);
      if (!res.ok) { onError(d.error); return; }
      setRows(d.subscriptions ?? []);
    } catch (e) { setLoading(false); onError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: { status?: string }) {
    if (!tenant) return;
    onError(null);
    try {
      const res = await fetch(`/api/merchant/subscriptions/${id}?tenant=${encodeURIComponent(tenant)}`, {
        method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { onError(d.error); return; }
      await load();
    } catch (e) { onError(String(e)); }
  }

  const STATUS_LABEL: Record<string, { t: string; bg: string; c: string }> = {
    active: { t: "Activa", bg: A_SOFT, c: A_DARK },
    paused: { t: "Pausada", bg: "#fdf3d7", c: "#8a6d1a" },
    cancelled: { t: "Cancelada", bg: "#f0f1f2", c: MUT },
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={sectionTitle}>Suscripciones de auto-envío</h2>
        <button onClick={load} className="mbtn" style={btnGhost}>{loading ? "Cargando…" : "Actualizar"}</button>
      </div>
      <p style={{ color: MUT, fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Cada suscripción genera el pedido solo cada X días (entra a “Pedidos” como los demás) y se cobra al recibir.
      </p>

      {rows.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: MUT, padding: 28 }}>
          Todavía no hay suscripciones. Cuando un cliente se suscriba a un producto, aparece acá.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((s) => {
            const st = STATUS_LABEL[s.status] ?? STATUS_LABEL.active!;
            return (
              <div key={s.id} className="mcard" style={{ ...card }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                      {s.qty}× {s.productName} <span style={{ color: MUT, fontWeight: 500 }}>· {s.variantName}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: MUT, marginTop: 3 }}>
                      {s.customerName || "Cliente"}{s.customerPhone ? ` · ${s.customerPhone}` : ""}{s.petName ? ` · 🐾 ${s.petName}` : ""}
                    </div>
                    <div style={{ fontSize: 12.5, color: MUT, marginTop: 3 }}>
                      Cada {s.intervalDays} días · próximo: <b style={{ color: INK }}>{fmt(s.nextRunAt)}</b>
                      {s.discountPercent > 0 ? ` · ${s.discountPercent}% off` : ""}
                      {s.lastError ? ` · ⚠ ${s.lastError === "sin_stock" ? "faltó stock" : s.lastError === "sin_precio" ? "sin precio" : s.lastError}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, background: st.bg, color: st.c, borderRadius: 999, padding: "3px 10px" }}>{st.t}</span>
                    {s.status !== "cancelled" && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {s.status === "active"
                          ? <button onClick={() => patch(s.id, { status: "paused" })} className="mbtn" style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5 }}>Pausar</button>
                          : <button onClick={() => patch(s.id, { status: "active" })} className="mbtn" style={{ ...btn, padding: "6px 10px", fontSize: 12.5 }}>Reanudar</button>}
                        <button onClick={() => { if (confirm("¿Cancelar esta suscripción?")) void patch(s.id, { status: "cancelled" }); }} className="mbtn" style={{ ...btnDanger, padding: "6px 10px", fontSize: 12.5 }}>Cancelar</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
        <Metric label="Comisión plataforma" value={money(s.commissionMinor)} accent="#0d7a80" hint="contribución" />
        <Metric label="A pagar a comercios" value={money(s.merchantPayoutMinor)} accent={A} hint="payout" />
        <Metric label="Envíos cobrados" value={money(s.deliveryRevenueMinor)} />
        <Metric label="Ticket promedio" value={money(s.avgTicketMinor)} />
        {Number(s.refundsMinor) > 0 && <Metric label="Devoluciones" value={money(s.refundsMinor)} accent="#c62828" />}
      </div>

      <div style={card}>
        <h3 style={sectionTitle}>Ventas últimos 14 días</h3>
        {data.series.length === 0 ? <p style={{ color: "#aaa", margin: 0 }}>Todavía no hay ventas.</p> : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {data.series.map((r) => (
              <div key={r.day} title={`${r.day}: ${money(r.gmvMinor)} · ${r.orders} pedido(s)`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", background: A, borderRadius: "4px 4px 0 0", height: `${Math.max(4, (Number(r.gmvMinor) / maxGmv) * 100)}%` }} />
                <span style={{ fontSize: 9, color: "#aaa" }}>{r.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={card}>
          <h3 style={sectionTitle}>Top productos</h3>
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
          <h3 style={sectionTitle}>Alertas de stock <span style={{ fontSize: 12, color: "#9aa2ab", fontWeight: 400 }}>(≤ 5)</span></h3>
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
  "storefront.heroImageUrl": "",
  "storefront.adoptionsBannerImageUrl": "",
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

/** Preview de una URL de imagen: valida que cargue y la muestra; si falla, avisa. */
function UrlPreview({ url, ratio }: { url: string; ratio: string }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [url]);
  const ok = /^https?:\/\/\S+$/i.test(url.trim());
  if (!ok) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {err ? (
        <div style={{ fontSize: 12, color: "#c0392b" }}>No se pudo cargar la imagen de esa URL.</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="preview" onError={() => setErr(true)} style={{ width: "100%", maxWidth: 320, aspectRatio: ratio, objectFit: "cover", borderRadius: 10, border: `1px solid ${LINE}`, display: "block" }} />
      )}
    </div>
  );
}

function DesignTab({ tenant, token, onError }: { tenant: string | null; token: string; onError: (s: string | null) => void }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [perksText, setPerksText] = useState("");
  const [benefitsText, setBenefitsText] = useState("");
  const [adoptionsTitle, setAdoptionsTitle] = useState("Adopciones");
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
    } catch (e) { setLoading(false); onError(String(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, token]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    onError(null);
    setSaving(true);
    try {
      const body = { ...theme, "storefront.perks": textToPairs(perksText), "storefront.benefits": textToPairs(benefitsText), "storefront.adoptionsTitle": adoptionsTitle };
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
        <Field label="Imagen del hero (URL)" hint="Foto principal de la home, aprox. 1080×450. Vacío = placeholder.">
          <input value={theme["storefront.heroImageUrl"]} onChange={(e) => set("storefront.heroImageUrl", e.target.value)} placeholder="https://…/hero.jpg" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          <UrlPreview url={theme["storefront.heroImageUrl"]} ratio="1080 / 450" />
        </Field>
        <Field label="Imagen del banner de Adopciones (URL)" hint="Foto del bloque de adopciones. Vacío = placeholder.">
          <input value={theme["storefront.adoptionsBannerImageUrl"]} onChange={(e) => set("storefront.adoptionsBannerImageUrl", e.target.value)} placeholder="https://…/adopciones.jpg" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          <UrlPreview url={theme["storefront.adoptionsBannerImageUrl"]} ratio="1080 / 540" />
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
        <Field label="Nombre de la sección de adopciones" hint="Ej: Adopciones, Callejeritos">
          <input value={adoptionsTitle} onChange={(e) => { setAdoptionsTitle(e.target.value); setSaved(false); }} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </Field>
        <p style={{ fontSize: 11.5, color: MUT, margin: "2px 0 0" }}>¿Buscás activar o desactivar funciones (Vendedor IA, suscripciones, adopciones…)? Ahora están en la pestaña <b>Configuración</b>.</p>

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
                  : <span style={{ width: 44, height: 44, borderRadius: 8, background: "#f2f2f2", color: "#9aa2ab", display: "grid", placeItems: "center" }}><PawPrint size={20} strokeWidth={1.7} /></span>}
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
