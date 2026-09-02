import type { ID, ISODateTime } from "./ids.js";

/**
 * Niveles de la jerarquía de configuración (decisión D1). Gana el más específico que
 * tenga un valor para la clave: user > merchant > region > tenant > platform.
 */
export type ConfigScopeType =
  | "platform"
  | "tenant"
  | "region"
  | "merchant"
  | "user";

/** Orden de especificidad (índice mayor = más específico = mayor precedencia). */
export const CONFIG_SCOPE_ORDER: readonly ConfigScopeType[] = [
  "platform",
  "tenant",
  "region",
  "merchant",
  "user",
] as const;

/** JSON Schema (draft 2020-12) representado de forma laxa (evita una dependencia dura). */
export type JsonSchema = Record<string, unknown>;

export type ConfigCategory =
  | "money" // comisiones, precios, tarifas → sensible, auditado
  | "branding"
  | "contact" // WhatsApp, teléfono, datos de contacto del comercio
  | "ops"
  | "features" // feature flags
  | "text"
  | "rules";

/**
 * Definición tipada de una clave de config. El valor se valida contra `jsonSchema` al
 * escribir (config tipada, decisión C1/D8). `sensitive` marca las de dinero/reglas, que
 * exigen auditoría (actor + reason) y effective-dating.
 */
export interface ConfigKeyDef {
  key: string;
  jsonSchema: JsonSchema;
  defaultValue: unknown;
  category: ConfigCategory;
  sensitive: boolean;
  description?: string;
}

/**
 * Un valor de config puesto en un scope. Versionado + auditoría + effective-dating:
 * cambiar una comisión o un precio es una acción de dinero y debe quedar registrada y
 * datada (no puede afectar pedidos ya en curso).
 */
export interface ConfigValue<V = unknown> {
  key: string;
  scopeType: ConfigScopeType;
  scopeId: ID;
  value: V;
  version: number;
  effectiveFrom: ISODateTime;
  actor: ID;
  reason?: string;
}

/** Coordenadas de resolución: qué scopes aplican a esta operación. */
export interface ConfigScopeChain {
  tenantId: ID;
  regionId?: ID;
  merchantId?: ID;
  userId?: ID;
}
