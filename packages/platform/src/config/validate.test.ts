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

describe("coerceConfigValue — valores guardados doble-codificados por postgres.js", () => {
  it("convierte según el tipo declarado de la clave", async () => {
    const { coerceConfigValue } = await import("./repository.js");
    // boolean: apagar una función tiene que dar false (antes quedaba "false" y seguía activa)
    expect(coerceConfigValue("false", { type: "boolean" })).toBe(false);
    expect(coerceConfigValue("true", { type: "boolean" })).toBe(true);
    expect(coerceConfigValue(false, { type: "boolean" })).toBe(false);
    // number/integer
    expect(coerceConfigValue("175000", { type: "integer" })).toBe(175000);
    expect(coerceConfigValue('"175000"', { type: "integer" })).toBe(175000);
    expect(coerceConfigValue(175000, { type: "integer" })).toBe(175000);
    // object/array
    expect(coerceConfigValue('[{"label":"Mañana"}]', { type: "array" })).toEqual([{ label: "Mañana" }]);
    // string: un PIN numérico sigue siendo texto; las comillas extra se sacan una vez
    expect(coerceConfigValue("482915", { type: "string" })).toBe("482915");
    expect(coerceConfigValue('"482915"', { type: "string" })).toBe("482915");
    expect(coerceConfigValue('"Pet Shop"', { type: "string" })).toBe("Pet Shop");
    expect(coerceConfigValue("#2E7D32", { type: "string" })).toBe("#2E7D32");
    // valores raros no rompen
    expect(coerceConfigValue("quizás", { type: "boolean" })).toBe("quizás");
    expect(coerceConfigValue("abc", { type: "integer" })).toBe("abc");
  });

  it("todas las claves del registro: el valor por defecto, guardado doble-codificado, vuelve igual", async () => {
    const { coerceConfigValue } = await import("./repository.js");
    const { CONFIG_KEYS } = await import("./registry.js");
    for (const def of Object.values(CONFIG_KEYS)) {
      const stored = JSON.stringify(def.defaultValue); // lo que guardaba postgres.js (jsonb string)
      expect(coerceConfigValue(stored, def.jsonSchema as { type?: unknown }), def.key).toEqual(def.defaultValue);
    }
  });
});
