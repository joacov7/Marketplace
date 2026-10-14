import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ db: () => ({}) }));
const { parseCart, MAX_CART_LINES } = await import("./cart.js");

const V = "7de1fbd8-c398-4d9d-9b7f-0d755a97563f";

describe("parseCart — validación del carrito (checkout y cotización)", () => {
  it("acepta cantidades enteras de 1 a 99", () => {
    expect(parseCart([{ variantId: V, qty: 1 }, { variantId: V, qty: 99 }])).toEqual({ ok: true, items: [{ variantId: V, qty: 1 }, { variantId: V, qty: 99 }] });
    expect(parseCart([{ variantId: V, qty: "3" }])).toEqual({ ok: true, items: [{ variantId: V, qty: 3 }] });
  });
  it("rechaza decimales (antes: error 500 en el checkout), cero, negativos y más de 99", () => {
    for (const qty of [1.5, 0, -2, 100, "abc", null]) expect(parseCart([{ variantId: V, qty }])).toEqual({ ok: false, error: "invalid_item" });
  });
  it("rechaza carrito vacío, no-lista, demasiadas líneas e ids inválidos", () => {
    expect(parseCart([])).toEqual({ ok: false, error: "empty_cart" });
    expect(parseCart("x")).toEqual({ ok: false, error: "empty_cart" });
    expect(parseCart(Array.from({ length: MAX_CART_LINES + 1 }, () => ({ variantId: V, qty: 1 })))).toEqual({ ok: false, error: "too_many_items" });
    expect(parseCart([{ variantId: "'; drop table", qty: 1 }])).toEqual({ ok: false, error: "invalid_item" });
  });
});
