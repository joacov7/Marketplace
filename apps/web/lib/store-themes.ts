/**
 * Estilos predefinidos de la tienda (branding.theme). Cada uno cambia la personalidad completa
 * —tipografía, paleta, formas, portada y fichas— vía variables CSS que lee la tienda; el color
 * de acento sigue siendo branding.primaryColor (cada estilo sugiere uno al elegirlo en Diseño).
 * "clasico" reproduce el aspecto original, así que es el default y no cambia nada por sí solo.
 */

export const THEME_IDS = ["clasico", "barrio", "natural", "moderno", "divertido"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Forma de la portada: dividida, en arco, foto completa con texto encima o bloque con contorno. */
export type HeroVariant = "split" | "arch" | "overlay" | "bubble";

export interface StoreTheme {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Color de acento sugerido (se aplica a branding.primaryColor al elegir el estilo). */
  accent: string;
  /** Google Fonts (css2) con las familias del estilo. */
  fontsHref: string;
  hero: HeroVariant;
  /** Variables CSS (--sf-*) que consume la tienda. */
  vars: Record<string, string>;
  /** Reglas extra para títulos (familia, peso, mayúsculas), con prioridad sobre los estilos inline. */
  headCss: string;
}

const base = {
  "--sf-white": "#FFFFFF",
  "--sf-wa": "#25D366",
};

export const STORE_THEMES: Record<ThemeId, StoreTheme> = {
  clasico: {
    id: "clasico",
    name: "Clásico",
    tagline: "El aspecto actual: limpio, verde y redondeado.",
    accent: "#087A50",
    fontsHref: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap",
    hero: "split",
    vars: {
      ...base,
      "--sf-font": "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      "--sf-ground": "#FFFFFF",
      "--sf-beige": "#F7F3EA", "--sf-surf": "#F7F6F2", "--sf-tint": "#EAF5EE", "--sf-icon-bg": "#E4F2EA",
      "--sf-text": "#222222", "--sf-text2": "#5A594F", "--sf-nav": "#4A4A44", "--sf-mute": "#8A8878", "--sf-ph": "#A19E8E",
      "--sf-border": "#ECEAE3", "--sf-border-beige": "#E4E1D8", "--sf-border-cart": "#F2F0E9", "--sf-radio-off": "#C9C7BC",
      "--sf-icon": "#66BB6A",
      "--sf-r-card": "16px", "--sf-r-img": "12px", "--sf-r-btn": "10px", "--sf-r-block": "20px",
      "--sf-card-border": "1px solid #ECEAE3", "--sf-card-shadow": "none",
      "--sf-btn-border": "none", "--sf-btn-shadow": "none", "--sf-btn-transform": "none",
      "--sf-price": "var(--sf-accent)", "--sf-sechead-border": "3px solid var(--sf-accent)",
      "--sf-hero-bg": "#F7F3EA",
    },
    headCss: "",
  },
  barrio: {
    id: "barrio",
    name: "Barrio",
    tagline: "Cálido y cercano: terracota, crema y letra redonda.",
    accent: "#B9472A",
    fontsHref: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap",
    hero: "split",
    vars: {
      ...base,
      "--sf-font": "'Nunito Sans', system-ui, sans-serif",
      "--sf-ground": "#FBF4EA",
      "--sf-beige": "#F3E2CF", "--sf-surf": "#FFF9F1", "--sf-tint": "#F6E7D6", "--sf-icon-bg": "#F1DCC5",
      "--sf-text": "#2A1E16", "--sf-text2": "#4A3A2F", "--sf-nav": "#3A2B21", "--sf-mute": "#6B5A4E", "--sf-ph": "#9A8676",
      "--sf-border": "#EFE2D1", "--sf-border-beige": "#E6D6C2", "--sf-border-cart": "#F3E8DA", "--sf-radio-off": "#CDB9A4",
      "--sf-icon": "#C7774F",
      "--sf-r-card": "22px", "--sf-r-img": "16px", "--sf-r-btn": "14px", "--sf-r-block": "28px",
      "--sf-card-border": "2px solid #EFE2D1", "--sf-card-shadow": "none",
      "--sf-btn-border": "none", "--sf-btn-shadow": "none", "--sf-btn-transform": "none",
      "--sf-price": "var(--sf-text)", "--sf-sechead-border": "none",
      "--sf-hero-bg": "#F3E2CF",
    },
    headCss: "font-family:'Bricolage Grotesque',sans-serif !important;font-weight:800 !important;",
  },
  natural: {
    id: "natural",
    name: "Natural",
    tagline: "Tranquilo y prolijo: verde salvia, beige y títulos con serifa.",
    accent: "#4F6F57",
    fontsHref: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Figtree:wght@400;500;600;700&display=swap",
    hero: "arch",
    vars: {
      ...base,
      "--sf-font": "'Figtree', system-ui, sans-serif",
      "--sf-ground": "#F3F1EA",
      "--sf-beige": "#E9E6DA", "--sf-surf": "#F7F5EF", "--sf-tint": "#E3E9DF", "--sf-icon-bg": "#D9E2D4",
      "--sf-text": "#1E2620", "--sf-text2": "#4A544C", "--sf-nav": "#2C362F", "--sf-mute": "#5E665F", "--sf-ph": "#8A918A",
      "--sf-border": "#D9D5C7", "--sf-border-beige": "#D9D5C7", "--sf-border-cart": "#E6E3D7", "--sf-radio-off": "#B9B6A8",
      "--sf-icon": "#6B8F71",
      "--sf-r-card": "6px", "--sf-r-img": "4px", "--sf-r-btn": "6px", "--sf-r-block": "10px",
      "--sf-card-border": "1px solid #D9D5C7", "--sf-card-shadow": "none",
      "--sf-btn-border": "none", "--sf-btn-shadow": "none", "--sf-btn-transform": "none",
      "--sf-price": "var(--sf-text)", "--sf-sechead-border": "none",
      "--sf-hero-bg": "transparent",
    },
    headCss: "font-family:'Fraunces',serif !important;font-weight:400 !important;",
  },
  moderno: {
    id: "moderno",
    name: "Moderno",
    tagline: "Tipo cadena grande: blanco y negro, un color vivo y bordes rectos.",
    accent: "#C43C06",
    fontsHref: "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&display=swap",
    hero: "overlay",
    vars: {
      ...base,
      "--sf-font": "'Archivo', system-ui, sans-serif",
      "--sf-ground": "#FFFFFF",
      "--sf-beige": "#F2F2F2", "--sf-surf": "#F7F7F7", "--sf-tint": "#F2F2F2", "--sf-icon-bg": "#E8E8E8",
      "--sf-text": "#111111", "--sf-text2": "#333333", "--sf-nav": "#111111", "--sf-mute": "#555555", "--sf-ph": "#777777",
      "--sf-border": "#D4D4D4", "--sf-border-beige": "#DDDDDD", "--sf-border-cart": "#EEEEEE", "--sf-radio-off": "#999999",
      "--sf-icon": "#555555",
      "--sf-r-card": "0px", "--sf-r-img": "0px", "--sf-r-btn": "0px", "--sf-r-block": "0px",
      "--sf-card-border": "2px solid #111111", "--sf-card-shadow": "none",
      "--sf-btn-border": "none", "--sf-btn-shadow": "none", "--sf-btn-transform": "uppercase",
      "--sf-price": "var(--sf-text)", "--sf-sechead-border": "none",
      "--sf-hero-bg": "#111111",
    },
    headCss: "font-weight:900 !important;text-transform:uppercase;letter-spacing:-0.02em !important;",
  },
  divertido: {
    id: "divertido",
    name: "Divertido",
    tagline: "Alegre y familiar: amarillo y azul, contornos gruesos y formas redondas.",
    accent: "#2D4BE0",
    fontsHref: "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800&display=swap",
    hero: "bubble",
    vars: {
      ...base,
      "--sf-font": "'Nunito', system-ui, sans-serif",
      "--sf-ground": "#FFF8E1",
      "--sf-beige": "#FFEFC2", "--sf-surf": "#FFFDF5", "--sf-tint": "#E8ECFF", "--sf-icon-bg": "#DCE2FF",
      "--sf-text": "#1B1B3A", "--sf-text2": "#3B3B5C", "--sf-nav": "#1B1B3A", "--sf-mute": "#4B4B6B", "--sf-ph": "#6E6E8C",
      "--sf-border": "#E3D6AE", "--sf-border-beige": "#E9D9A6", "--sf-border-cart": "#F3E6BF", "--sf-radio-off": "#8A8AA6",
      "--sf-icon": "#5B6FE8",
      "--sf-r-card": "28px", "--sf-r-img": "20px", "--sf-r-btn": "999px", "--sf-r-block": "36px",
      "--sf-card-border": "3px solid #1B1B3A", "--sf-card-shadow": "6px 6px 0 #1B1B3A",
      "--sf-btn-border": "2px solid #1B1B3A", "--sf-btn-shadow": "3px 3px 0 #1B1B3A", "--sf-btn-transform": "none",
      "--sf-price": "var(--sf-accent)", "--sf-sechead-border": "none",
      "--sf-hero-bg": "#FFC93C",
    },
    headCss: "font-family:'Fredoka',sans-serif !important;font-weight:700 !important;",
  },
};

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
}

export function storeTheme(v: unknown): StoreTheme {
  return STORE_THEMES[isThemeId(v) ? v : "clasico"];
}
