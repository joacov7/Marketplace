import { describe, it, expect } from "vitest";
import { validateConfigValue } from "./validate.js";

describe("Config — validación por JSON Schema al escribir", () => {
  const schema = {
    type: "integer",
    minimum: 0,
    maximum: 5000, // comisión en bps: 0%..50%
  };

  it("acepta un valor válido (7% = 700 bps)", () => {
    expect(validateConfigValue(schema, 700).ok).toBe(true);
  });

  it("rechaza fuera de rango y no-entero", () => {
    expect(validateConfigValue(schema, 6000).ok).toBe(false);
    expect(validateConfigValue(schema, 7.5).ok).toBe(false);
  });
});
