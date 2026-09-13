import type {
  ContentTheme,
  ContentTemplate,
  ContentPost,
  GeneratePostInput,
  BrandKit,
  FeaturedProduct,
} from "./types.js";
import { THEME_LABEL } from "./types.js";

/** Días transcurridos desde época (semilla estable por fecha, no por hora). */
function daySeed(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
}

/** Tema del día según el calendario del tenant (0=Dom … 6=Sáb). Fallback: "calido". */
export function themeForDate(schedule: Partial<Record<string, ContentTheme>>, date: Date): ContentTheme {
  return schedule[String(date.getUTCDay())] ?? "calido";
}

/** Módulo positivo (evita índices negativos con variantes negativas). */
function mod(n: number, m: number): number {
  return m <= 0 ? 0 : ((n % m) + m) % m;
}

/** Reemplaza tokens {clave} y colapsa espacios que queden por tokens vacíos. */
function fill(template: string, tokens: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** ¿El tema necesita un producto real para tener sentido? */
function needsProduct(theme: ContentTheme): boolean {
  return theme === "producto" || theme === "oferta";
}

/**
 * Genera el post del día: DETERMINISTA a partir de la fecha (mismo día → mismo post), con
 * rotación de variante y de producto destacado para que el contenido cambie. `variant` fuerza
 * una variante puntual (botón "otra variante" en el panel). No hay azar: es reproducible.
 */
export function generatePost(input: GeneratePostInput): ContentPost {
  const theme = input.theme ?? themeForDate(input.schedule, input.date);
  const seed = daySeed(input.date);

  const variants = input.templates[theme] ?? [];
  const variantCount = variants.length;
  const variant = variantCount > 0 ? mod(input.variant ?? seed, variantCount) : 0;
  const tpl: ContentTemplate = variants[variant] ?? { title: input.brand.store, body: "" };

  // Producto destacado del día: rota por semilla+variante sobre el catálogo en stock.
  let product: FeaturedProduct | null = null;
  if (input.products.length > 0 && (needsProduct(theme) || /\{product\}/.test(`${tpl.title}${tpl.body}`))) {
    product = input.products[mod(seed + variant, input.products.length)] ?? null;
  }

  const tokens: Record<string, string> = {
    store: input.brand.store,
    handle: input.brand.handle || input.brand.store,
    phone: input.brand.phone ?? "",
    product: product?.name ?? "nuestros productos",
    price: product?.priceLabel ?? "",
    discount: input.subscriptionDiscountPercent ? `${input.subscriptionDiscountPercent}%` : "",
  };

  return {
    theme,
    themeLabel: THEME_LABEL[theme],
    title: fill(tpl.title, tokens),
    body: fill(tpl.body, tokens),
    hashtags: normalizeHashtags(input.hashtags),
    product,
    variant,
    variantCount,
  };
}

/** Normaliza hashtags: agrega el `#`, saca espacios, quita vacíos y duplicados. */
export function normalizeHashtags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of raw) {
    const clean = h.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!clean) continue;
    const tag = `#${clean}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Texto completo listo para copiar y pegar en la red (título + cuerpo + hashtags). */
export function postToText(post: ContentPost): string {
  const parts = [post.title, post.body].filter((s) => s.trim().length > 0);
  const tags = post.hashtags.join(" ");
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}
