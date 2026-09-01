/**
 * Sanea una URL provista por el comercio antes de guardarla o renderizarla. Solo acepta
 * http/https (descarta javascript:/data:/otros esquemas que podrían inyectarse en un
 * <img src> o en url() de CSS). Devuelve "" si no es válida.
 */
export function safeUrl(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/^"+|"+$/g, "").trim() : "";
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
}
