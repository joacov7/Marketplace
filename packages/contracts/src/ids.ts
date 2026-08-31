/** Identificador opaco. La implementación decide el formato (uuid, etc.). */
export type ID = string;

/** Timestamp ISO-8601 (UTC). */
export type ISODateTime = string;

/**
 * Referencia genérica a cualquier entidad (del core o de un módulo de vertical).
 * Evita supuestos de rubro hardcodeados (ej. protected_products) — igual que
 * el EntityRef de agent-core.
 */
export interface EntityRef {
  type: string;
  id: ID;
}
