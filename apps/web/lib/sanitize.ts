/**
 * Sanea una URL provista por el comercio antes de guardarla o renderizarla. Solo acepta
 * http/https (descarta javascript:/data:/otros esquemas que podrían inyectarse en un
 * <img src> o en url() de CSS). Devuelve "" si no es válida.
 */
const INTERNAL_IMAGE = /^\/api\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeUrl(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/^"+|"+$/g, "").trim() : "";
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s;
  // Foto subida y guardada en la base: path interno con UUID opaco (no es un esquema inyectable).
  if (INTERNAL_IMAGE.test(s)) return s;
  return "";
}
