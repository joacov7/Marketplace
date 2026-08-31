import type { ID } from "./ids.js";

/** Quién origina una operación (para auditoría y enforcement). */
export interface Actor {
  type: "user" | "agent" | "system";
  id: ID;
  /** Rol/actor de negocio: cliente, staff del comercio, admin, cadete… (informativo). */
  role?: string;
}

/**
 * Contexto de tenant OBLIGATORIO. Sin TenantContext el sistema no ejecuta (falla
 * cerrado) — mismo principio que agent-core. Se resuelve desde el dominio/subdominio o
 * el JWT en el borde (BFF), nunca de un parámetro que el cliente pueda falsear, y viaja
 * a cada query. El aislamiento real lo fuerza Postgres RLS con `app.tenant_id`
 * (decisión D4); este contexto es lo que setea esa variable de sesión por transacción.
 */
export interface TenantContext {
  tenantId: ID;
  /** Región (ciudad) activa dentro del tenant, si aplica (D1: ciudad = región). */
  regionId?: ID;
  actor: Actor;
  /** Id de traza para correlacionar logs, gasto de IA y auditoría. */
  requestId?: ID;
  /** Locale para textos (ej. "es-AR"). */
  locale?: string;
  /** Reloj inyectable (tests/determinismo). */
  now?: () => Date;
}
