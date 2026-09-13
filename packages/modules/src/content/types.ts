/**
 * Estudio de contenido: el agente que arma la publicación del día (texto + placa) para que
 * el comercio la apruebe y suba a sus redes. NADA se hardcodea por tenant: el calendario de
 * temas, las plantillas de copy y los hashtags viven en config (registry) y se editan por
 * comercio. El módulo es PURO: recibe los datos (marca, plantillas, productos) y devuelve el
 * post; no toca DB ni red. La publicación a Meta (Graph API) es un paso posterior e inyectable.
 */

/** Temas de contenido. El calendario (día de semana → tema) es configurable por tenant. */
export type ContentTheme = "tip" | "producto" | "oferta" | "suscripcion" | "testimonio" | "calido";

export const CONTENT_THEMES: ContentTheme[] = ["tip", "producto", "oferta", "suscripcion", "testimonio", "calido"];

export const THEME_LABEL: Record<ContentTheme, string> = {
  tip: "Tip",
  producto: "Producto",
  oferta: "Oferta",
  suscripcion: "Suscripción",
  testimonio: "Testimonio",
  calido: "Comunidad",
};

/** Plantilla de copy: título + cuerpo con tokens {store} {product} {price} {handle} {phone} {discount}. */
export interface ContentTemplate {
  title: string;
  body: string;
}

/** Identidad de marca para la placa (todo desde config/branding del tenant). */
export interface BrandKit {
  store: string;
  primaryColor: string;
  secondaryColor: string;
  handle?: string;
  phone?: string;
}

/** Producto real del catálogo para los temas que lo necesitan (producto/oferta). */
export interface FeaturedProduct {
  name: string;
  priceLabel?: string;
  category?: string | null;
}

export interface GeneratePostInput {
  /** Fecha objetivo (define el tema del día y la semilla de rotación). */
  date: Date;
  /** Fuerza un tema (el usuario elige otro día/tema en el panel). Si no, sale del calendario. */
  theme?: ContentTheme;
  /** Índice de variante a mostrar (para "otra variante"). Si no, rota por fecha. */
  variant?: number;
  /** Calendario semanal: día (0=Dom … 6=Sáb, como string) → tema. */
  schedule: Partial<Record<string, ContentTheme>>;
  /** Plantillas por tema (una o varias variantes). */
  templates: Partial<Record<ContentTheme, ContentTemplate[]>>;
  hashtags: string[];
  brand: BrandKit;
  /** Catálogo en stock para elegir el destacado del día. */
  products: FeaturedProduct[];
  /** % de descuento de suscripción (token {discount}). */
  subscriptionDiscountPercent?: number;
}

/** Post generado, listo para revisar/editar y publicar a mano. */
export interface ContentPost {
  theme: ContentTheme;
  themeLabel: string;
  title: string;
  body: string;
  hashtags: string[];
  product: FeaturedProduct | null;
  /** Índice de la variante usada y cuántas hay (para el botón "otra variante"). */
  variant: number;
  variantCount: number;
}

/**
 * Copywriter inyectable. El default es DETERMINISTA (plantillas + datos reales, sin LLM ni
 * costo). Un copywriter real (Claude) se enchufa sin tocar la orquestación — misma inversión
 * de dependencia que el Vendedor. `write` puede ser sync (determinista) o async (LLM).
 */
export interface AiCopywriter {
  write(input: ContentTemplate & { brand: BrandKit; product: FeaturedProduct | null }): ContentTemplate | Promise<ContentTemplate>;
}
