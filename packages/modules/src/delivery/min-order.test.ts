import { describe, it, expect } from "vitest";
import { applyMinOrder } from "./delivery.js";

const cfg = { minOrderMinor: 2_000_000n, minOrderNoFoodMinor: 3_000_000n }; // $20.000 / $30.000

describe("applyMinOrder", () => {
  it("con alimento aplica el mínimo base", () => {
    const r = applyMinOrder({ hasFood: true, gmvMinor: 2_500_000n, config: cfg });
    expect(r.minMinor).toBe(2_000_000n);
    expect(r.meets).toBe(true);
    expect(r.missingMinor).toBe(0n);
  });

  it("sin alimento aplica el mínimo (más alto) de almacén", () => {
    const r = applyMinOrder({ hasFood: false, gmvMinor: 2_500_000n, config: cfg });
    expect(r.minMinor).toBe(3_000_000n);
    expect(r.meets).toBe(false);
    expect(r.missingMinor).toBe(500_000n); // faltan $5.000
  });

  it("el mismo carrito puede alcanzar con alimento y no sin alimento", () => {
    const withFood = applyMinOrder({ hasFood: true, gmvMinor: 2_500_000n, config: cfg });
    const noFood = applyMinOrder({ hasFood: false, gmvMinor: 2_500_000n, config: cfg });
    expect(withFood.meets).toBe(true);
    expect(noFood.meets).toBe(false);
  });

  it("mínimo en 0 = sin mínimo (siempre alcanza)", () => {
    const r = applyMinOrder({ hasFood: false, gmvMinor: 1n, config: { minOrderMinor: 0n, minOrderNoFoodMinor: 0n } });
    expect(r.meets).toBe(true);
    expect(r.missingMinor).toBe(0n);
  });

  it("justo en el mínimo alcanza (borde inclusivo)", () => {
    const r = applyMinOrder({ hasFood: false, gmvMinor: 3_000_000n, config: cfg });
    expect(r.meets).toBe(true);
    expect(r.missingMinor).toBe(0n);
  });
});
