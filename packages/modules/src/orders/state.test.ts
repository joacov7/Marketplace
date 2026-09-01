import { describe, it, expect } from "vitest";
import { canTransitionOrder, canTransitionSellerOrder, isCompensatingSellerStatus } from "./state.js";

describe("Máquina de estados del pedido", () => {
  it("permite transiciones válidas del order", () => {
    expect(canTransitionOrder("pending_payment", "confirmed")).toBe(true);
    expect(canTransitionOrder("confirmed", "partially_refunded")).toBe(true);
    expect(canTransitionOrder("partially_refunded", "refunded")).toBe(true);
  });

  it("rechaza transiciones inválidas del order", () => {
    expect(canTransitionOrder("pending_payment", "completed")).toBe(false);
    expect(canTransitionOrder("cancelled", "confirmed")).toBe(false);
    expect(canTransitionOrder("refunded", "confirmed")).toBe(false);
  });

  it("cumplimiento del seller_order: camino feliz y fallas", () => {
    expect(canTransitionSellerOrder("pending", "preparing")).toBe(true);
    expect(canTransitionSellerOrder("preparing", "ready")).toBe(true);
    expect(canTransitionSellerOrder("ready", "in_transit")).toBe(true);
    expect(canTransitionSellerOrder("in_transit", "delivered")).toBe(true);
    expect(canTransitionSellerOrder("in_transit", "delivery_failed")).toBe(true);
    expect(canTransitionSellerOrder("delivery_failed", "in_transit")).toBe(true); // reintento
    expect(canTransitionSellerOrder("delivered", "in_transit")).toBe(false); // terminal
  });

  it("identifica estados que requieren compensación", () => {
    expect(isCompensatingSellerStatus("rejected")).toBe(true);
    expect(isCompensatingSellerStatus("delivery_failed")).toBe(true);
    expect(isCompensatingSellerStatus("delivered")).toBe(false);
  });
});
