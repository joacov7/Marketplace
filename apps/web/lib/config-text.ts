/**
 * Limpieza defensiva de textos de config para mostrar. Valores guardados antes del arreglo de
 * jsonb (migración 0022) pueden traer comillas y barras sobrantes en los bordes
 * (ej. `\"Pet Shop\`); se quitan para que no se vean en la tienda.
 */
const EDGE_JUNK = /^[\\"]+|[\\"]+$/g;

export function cleanText(v: string | undefined | null, fallback: string): string {
  const s = (typeof v === "string" ? v : "").trim().replace(EDGE_JUNK, "").trim();
  return s.length > 0 ? s : fallback;
}

/** Normaliza un color de config a un hex CSS válido (con fallback). */
export function cssColor(v: string | undefined | null, fallback = "#2E7D32"): string {
  const s = cleanText(v, "");
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}
