/**
 * Máquinas de estado del pedido ([G2]). El ciclo de PAGO/global vive en `order`; el de
 * CUMPLIMIENTO (preparación/entrega) vive en cada `seller_order`. Transiciones válidas
 * explícitas; toda transición a un estado terminal negativo dispara compensación
 * (liberar reserva de stock + refund) en la capa de servicio.
 */

export type OrderStatus =
  | "pending_payment"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export type SellerOrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "in_transit"
  | "delivered"
  | "rejected"
  | "delivery_failed"
  | "cancelled";

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled", "refunded", "partially_refunded"],
  completed: ["refunded", "partially_refunded"],
  partially_refunded: ["refunded"],
  cancelled: [],
  refunded: [],
};

const SELLER_ORDER_TRANSITIONS: Record<SellerOrderStatus, readonly SellerOrderStatus[]> = {
  pending: ["preparing", "rejected", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["in_transit"],
  in_transit: ["delivered", "delivery_failed"],
  delivery_failed: ["in_transit", "cancelled"],
  delivered: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function canTransitionSellerOrder(from: SellerOrderStatus, to: SellerOrderStatus): boolean {
  return SELLER_ORDER_TRANSITIONS[from].includes(to);
}

/** Estados terminales negativos que requieren compensación (release de stock / refund). */
export function isCompensatingSellerStatus(s: SellerOrderStatus): boolean {
  return s === "rejected" || s === "cancelled" || s === "delivery_failed";
}
