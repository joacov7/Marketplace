"use client";

import { useState } from "react";

const input: React.CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 10, border: "1px solid #d9d6cf", fontSize: 15, background: "#fff", boxSizing: "border-box", fontFamily: "inherit" };
const label: React.CSSProperties = { display: "block", fontSize: 13.5, fontWeight: 600, margin: "14px 0 6px" };

export default function WithdrawalForm({ tenant, primary, whatsapp }: { tenant: string; primary: string; whatsapp: string }) {
  const [f, setF] = useState({ name: "", contact: "", orderRef: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; createdAt: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/arrepentimiento?tenant=${encodeURIComponent(tenant)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.message ?? "No pudimos registrar la solicitud. Probá de nuevo o escribinos por WhatsApp."); return; }
      setDone(d);
    } catch {
      setError("No pudimos registrar la solicitud. Revisá tu conexión y probá de nuevo.");
    } finally { setBusy(false); }
  }

  if (done) {
    const when = new Date(done.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
    const wa = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, hice una solicitud de arrepentimiento. Código: ${done.code}`)}` : null;
    return (
      <div style={{ background: "#fff", border: `2px solid ${primary}`, borderRadius: 14, padding: 20, marginTop: 20 }}>
        <div style={{ fontSize: 14, color: "#555" }}>Recibimos tu solicitud ({when}). Tu código es:</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: ".04em", color: primary, margin: "6px 0 10px" }}>{done.code}</div>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>Guardalo: te vamos a contactar para coordinar la devolución. Si querés, avisanos también por WhatsApp.</p>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 14, background: "#25D366", color: "#fff", borderRadius: 10, padding: "10px 16px", fontWeight: 700, textDecoration: "none" }}>Avisar por WhatsApp</a>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ background: "#fff", border: "1px solid #e7e5df", borderRadius: 14, padding: 20, marginTop: 20 }}>
      <label style={label} htmlFor="arr-name">Nombre y apellido *</label>
      <input id="arr-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={input} autoComplete="name" />
      <label style={label} htmlFor="arr-contact">Teléfono o email *</label>
      <input id="arr-contact" required value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} style={input} autoComplete="tel" />
      <label style={label} htmlFor="arr-order">Número de pedido (si lo tenés)</label>
      <input id="arr-order" value={f.orderRef} onChange={(e) => setF({ ...f, orderRef: e.target.value })} style={input} placeholder="Ej. #ab12cd34" />
      <label style={label} htmlFor="arr-msg">Comentario (opcional)</label>
      <textarea id="arr-msg" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} style={{ ...input, minHeight: 90, resize: "vertical" }} />
      {error && <p style={{ color: "#c62828", fontSize: 14, margin: "12px 0 0" }}>{error}</p>}
      <button type="submit" disabled={busy} style={{ marginTop: 18, width: "100%", background: primary, color: "#fff", border: "none", borderRadius: 10, padding: "13px 16px", fontSize: 15.5, fontWeight: 700, cursor: "pointer" }}>
        {busy ? "Enviando…" : "Enviar solicitud de arrepentimiento"}
      </button>
    </form>
  );
}
