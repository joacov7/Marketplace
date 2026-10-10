import { describe, it, expect } from "vitest";
import { newIds, titleWithCount } from "./order-alerts.js";

describe("newIds — detectar pedidos nuevos", () => {
  it("en la primera carga no avisa lo que ya estaba", () => {
    expect(newIds(null, ["a", "b"])).toEqual([]);
  });
  it("avisa solo los que aparecen", () => {
    expect(newIds(["a"], ["b", "a"])).toEqual(["b"]);
    expect(newIds(["a", "b"], ["a"])).toEqual([]); // uno que sale (entregado) no es nuevo
    expect(newIds(["a"], ["a"])).toEqual([]);
  });
});

describe("titleWithCount", () => {
  it("muestra el contador en la pestaña", () => {
    expect(titleWithCount("Panel", 0)).toBe("Panel");
    expect(titleWithCount("Panel", 1)).toBe("(1) Nuevo pedido · Panel");
    expect(titleWithCount("Panel", 3)).toBe("(3) Nuevos pedidos · Panel");
  });
});
