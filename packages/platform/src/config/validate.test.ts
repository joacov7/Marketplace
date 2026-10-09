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

describe("ops.deliveryPin — largo mínimo", () => {
  it("acepta vacío o 6–32 caracteres; rechaza PINs cortos", async () => {
    const { getConfigKeyDef } = await import("./registry.js");
    const schema = getConfigKeyDef("ops.deliveryPin")!.jsonSchema;
    expect(validateConfigValue(schema, "").ok).toBe(true);
    expect(validateConfigValue(schema, "482915").ok).toBe(true);
    expect(validateConfigValue(schema, "a".repeat(32)).ok).toBe(true);
    expect(validateConfigValue(schema, "2468").ok).toBe(false);
    expect(validateConfigValue(schema, "12345").ok).toBe(false);
    expect(validateConfigValue(schema, "a".repeat(33)).ok).toBe(false);
  });
});
