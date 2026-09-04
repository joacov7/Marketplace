"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, PackageCheck, Bike, PartyPopper, PawPrint } from "lucide-react";

interface Track {
  stage: "recibido" | "preparando" | "en_camino" | "entregado" | "cancelado";
  step: number;
  label: string;
  petName: string | null;
  itemCount: number;
  totalMinor: string;
  currency: string;
  deliveryWindow: string | null;
  createdAt: string;
}

const C = { green: "#2e7d32", soft: "#e9f4ea", ink: "#1f2a2e", mut: "#6b7280", line: "#e7e9ec", bg: "#f4f6f5", white: "#fff", red: "#c0392b" };
const money = (m: string, c = "ARS") => (Number(m) / 100).toLocaleString("es-AR", { style: "currency", currency: c });
const STEPS: Array<{ key: string; label: string; Icon: typeof ClipboardList }> = [
  { key: "recibido", label: "Recibido", Icon: ClipboardList },
  { key: "preparando", label: "En preparación", Icon: PackageCheck },
  { key: "en_camino", label: "En camino", Icon: Bike },
  { key: "entregado", label: "Entregado", Icon: PartyPopper },
];

export default function TrackClient({ id, tenant }: { id: string; tenant: string }) {
  const [t, setT] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenant) { setError("Falta el comercio en el enlace."); setLoading(false); return; }
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(id)}?tenant=${encodeURIComponent(tenant)}`);
      if (res.ok) { setT(await res.json()); setError(null); }
      else setError(res.status === 404 ? "No encontramos este pedido." : "No pudimos cargar el seguimiento.");
    } catch { setError("No pudimos cargar el seguimiento."); }
    finally { setLoading(false); }
  }, [id, tenant]);

  useEffect(() => { void load(); }, [load]);
  // Auto-refresh en vivo cada 20 s (sin recargar la página).
  useEffect(() => {
    const iv = setInterval(() => void load(), 20000);
    return () => clearInterval(iv);
  }, [load]);

  const pet = t?.petName?.trim();
  const cancelled = t?.stage === "cancelado";

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", background: C.bg, minHeight: "100vh", color: C.ink }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 18px 60px" }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ color: C.green, display: "flex", justifyContent: "center" }}><PawPrint size={30} strokeWidth={1.8} /></div>
          <h1 style={{ fontSize: 22, margin: "8px 0 2px", letterSpacing: "-.01em" }}>
            {pet ? <>Pedido de {pet}</> : <>Tu pedido</>}
          </h1>
          <div style={{ fontSize: 12.5, color: C.mut }}>#{id.slice(0, 8)}</div>
        </div>

        {loading && !t ? (
          <p style={{ textAlign: "center", color: C.mut }}>Cargando…</p>
        ) : error ? (
          <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: 22, textAlign: "center", color: C.mut }}>{error}</div>
        ) : t ? (
          <>
            <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 16, padding: 22, boxShadow: "0 1px 2px rgba(16,24,40,.04)" }}>
              <div style={{ textAlign: "center", marginBottom: cancelled ? 0 : 22 }}>
                <span style={{ fontSize: 13, color: C.mut }}>Estado actual</span>
                <div style={{ fontSize: 22, fontWeight: 800, color: cancelled ? C.red : C.green, marginTop: 2 }}>{t.label}</div>
              </div>

              {!cancelled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {STEPS.map((s, i) => {
                    const done = i <= t.step;
                    const current = i === t.step;
                    return (
                      <div key={s.key} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div style={{ width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center",
                            background: done ? C.green : C.soft, color: done ? "white" : C.mut,
                            boxShadow: current ? `0 0 0 4px ${C.soft}` : "none", transition: "all .2s" }}><s.Icon size={18} strokeWidth={1.9} /></div>
                          {i < STEPS.length - 1 && <div style={{ width: 2, height: 26, background: i < t.step ? C.green : C.line }} />}
                        </div>
                        <div style={{ paddingTop: 8 }}>
                          <div style={{ fontSize: 15, fontWeight: current ? 700 : 600, color: done ? C.ink : C.mut }}>{s.label}</div>
                          {current && <div style={{ fontSize: 12.5, color: C.green, fontWeight: 600 }}>Ahora</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginTop: 14, fontSize: 13.5, color: C.ink }}>
              <Row k="Artículos" v={`${t.itemCount}`} />
              <Row k="Total" v={money(t.totalMinor, t.currency)} />
              {t.deliveryWindow && <Row k="Entrega" v={t.deliveryWindow} />}
            </div>

            <p style={{ textAlign: "center", color: C.mut, fontSize: 11.5, marginTop: 18 }}>
              Se actualiza solo. Te avisamos por WhatsApp cuando salga a entregar.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ color: "#6b7280" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
}
