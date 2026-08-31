import type { ID, ISODateTime } from "./ids.js";

/**
 * Evento de dominio publicado por el outbox transaccional. Se escribe en la MISMA
 * transacción que el cambio de estado (evita el dual-write pedido↔pago↔notificación) y
 * un worker/cron lo publica luego. Contratos versionados desde V1 (decisión A2), aunque
 * el transporte V1 sea una tabla + Vercel Cron.
 */
export interface DomainEvent<P = unknown> {
  id: ID;
  tenantId: ID;
  /** Ej. "order.confirmed", "payment.captured", "delivery.completed", "config.changed". */
  type: string;
  /** Versión del contrato del evento. */
  version: number;
  payload: P;
  occurredAt: ISODateTime;
}

export type OutboxStatus = "pending" | "published";
