import type { ConfigKeyDef } from "@commerce/contracts";

/**
 * Catálogo tipado de claves de config conocidas (C1/D8). Cada clave declara su JSON
 * Schema (validación al escribir), su default de plataforma y su categoría. Las claves de
 * dinero/reglas son `sensitive` → exigen auditoría (actor + reason) y effective-dating.
 *
 * Los valores por defecto salen de los escenarios de rentabilidad de Fase 0 (L4): son
 * PARÁMETROS, no constantes del código. Cambiarlos es config, no un deploy.
 */
export const CONFIG_KEYS = {
  "commission.rateBps": {
    key: "commission.rateBps",
    jsonSchema: { type: "integer", minimum: 0, maximum: 5000 },
    defaultValue: 700, // 7% (L4)
    category: "money",
    sensitive: true,
    description: "Comisión de la plataforma sobre el GMV, en puntos básicos (700 = 7%).",
  },
  "delivery.customerChargeMinor": {
    key: "delivery.customerChargeMinor",
    jsonSchema: { type: "integer", minimum: 0 },
    defaultValue: 150000, // $1.500 (centavos)
    category: "money",
    sensitive: true,
    description: "Cargo de delivery al cliente por defecto, en centavos.",
  },
  "delivery.freeOverOrderTotalMinor": {
    key: "delivery.freeOverOrderTotalMinor",
    jsonSchema: { type: "integer", minimum: 0 },
    defaultValue: 5000000, // gratis sobre $50.000 (L4)
    category: "money",
    sensitive: true,
    description: "Umbral de compra por sobre el cual el delivery es gratis, en centavos.",
  },
  "delivery.subsidySource": {
    key: "delivery.subsidySource",
    jsonSchema: { type: "string", enum: ["platform", "merchant", "promo", "none"] },
    defaultValue: "platform",
    category: "rules",
    sensitive: true,
    description: "Quién financia el gap entre el costo del cadete y lo que paga el cliente.",
  },
  "orders.maxSellersPerOrder": {
    key: "orders.maxSellersPerOrder",
    jsonSchema: { type: "integer", minimum: 1, maximum: 100 },
    defaultValue: 1, // V1: 1 pedido = 1 comercio (config, NO código — [E1])
    category: "features",
    sensitive: false,
    description: "Máximo de comercios por pedido. V1 = 1; subirlo habilita multi-seller.",
  },
  "features.customerAgent": {
    key: "features.customerAgent",
    jsonSchema: { type: "boolean" },
    defaultValue: true,
    category: "features",
    sensitive: false,
    description: "Habilita el Customer Shopping Agent.",
  },
  "features.loyalty": {
    key: "features.loyalty",
    jsonSchema: { type: "boolean" },
    defaultValue: false,
    category: "features",
    sensitive: false,
    description: "Habilita el módulo de fidelización.",
  },
  "branding.primaryColor": {
    key: "branding.primaryColor",
    jsonSchema: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    defaultValue: "#2563eb",
    category: "branding",
    sensitive: false,
    description: "Color primario de marca del tenant.",
  },
  "branding.displayName": {
    key: "branding.displayName",
    jsonSchema: { type: "string", minLength: 1, maxLength: 80 },
    defaultValue: "Commerce",
    category: "branding",
    sensitive: false,
    description: "Nombre visible de la marca del tenant.",
  },
  "tenant.vertical": {
    key: "tenant.vertical",
    jsonSchema: { type: "string", minLength: 1 },
    defaultValue: "generic",
    category: "features",
    sensitive: false,
    description: "Vertical activo del tenant (pet_shop, etc.). Define qué módulo de vertical aplica.",
  },
  "modules.enabled": {
    key: "modules.enabled",
    jsonSchema: { type: "array", items: { type: "string" } },
    defaultValue: [],
    category: "features",
    sensitive: false,
    description: "Módulos habilitados para el tenant (feature flags de módulo).",
  },
} as const satisfies Record<string, ConfigKeyDef>;

export type ConfigKeyName = keyof typeof CONFIG_KEYS;

export function getConfigKeyDef(key: string): ConfigKeyDef | undefined {
  return (CONFIG_KEYS as Record<string, ConfigKeyDef>)[key];
}
