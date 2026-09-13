import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * Renderiza la PLACA (imagen 1080×1080 lista para subir a Instagram/Facebook) del post del día.
 * Es un renderizador PURO: solo vuelca a una imagen el texto y los colores que le pasan por query
 * (?title=&body=&tag=&store=&handle=&price=&pc=&sc=). No lee la base ni datos del tenant (el texto
 * es contenido de marketing que igual va a ser público), así puede usarse directo como <img src>
 * sin cabecera de auth. La composición del texto (con datos reales) la hace /content/today.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
function color(v: string | null, fallback: string): string {
  return v && HEX.test(v) ? v : fallback;
}
function clamp(v: string | null, max: number): string {
  const s = (v ?? "").slice(0, max);
  return s;
}
/** Tamaño de título según largo, para que entre siempre sin desbordar. */
function titleSize(len: number): number {
  if (len <= 22) return 92;
  if (len <= 40) return 76;
  if (len <= 70) return 60;
  return 48;
}
function initials(store: string): string {
  const words = store.trim().split(/\s+/).filter(Boolean);
  const two = (words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "");
  return two.toUpperCase() || "PS";
}

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const pc = color(q.get("pc"), "#0a7d4b");
  const sc = color(q.get("sc"), "#0b3d2e");
  const store = clamp(q.get("store"), 40) || "Tu Tienda";
  const tag = clamp(q.get("tag"), 24) || "Novedad";
  const title = clamp(q.get("title"), 140) || store;
  const body = clamp(q.get("body"), 320);
  const handle = clamp(q.get("handle"), 60);
  const price = clamp(q.get("price"), 24);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1080px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundImage: `linear-gradient(135deg, ${pc} 0%, ${sc} 100%)`,
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        {/* Encabezado: etiqueta del tema + iniciales de la marca */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              background: "rgba(255,255,255,0.18)",
              padding: "14px 30px",
              borderRadius: "999px",
            }}
          >
            {tag}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "104px",
              height: "104px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.16)",
              fontSize: "44px",
              fontWeight: 800,
            }}
          >
            {initials(store)}
          </div>
        </div>

        {/* Cuerpo: título grande + texto */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: `${titleSize(title.length)}px`, fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.02em" }}>
            {title}
          </div>
          {body ? (
            <div style={{ display: "flex", marginTop: "34px", fontSize: "38px", lineHeight: 1.35, color: "rgba(255,255,255,0.92)", maxWidth: "820px" }}>
              {body}
            </div>
          ) : null}
        </div>

        {/* Pie: marca / handle + chip de precio */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: "40px", fontWeight: 800 }}>{store}</div>
            {handle ? <div style={{ display: "flex", fontSize: "30px", color: "rgba(255,255,255,0.85)", marginTop: "6px" }}>{handle}</div> : null}
          </div>
          {price ? (
            <div
              style={{
                display: "flex",
                fontSize: "48px",
                fontWeight: 800,
                color: pc,
                background: "white",
                padding: "18px 36px",
                borderRadius: "20px",
              }}
            >
              {price}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: 1080, height: 1080 },
  );
}
