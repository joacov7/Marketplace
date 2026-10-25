import { describe, it, expect } from "vitest";
import { cleanText, cssColor } from "./config-text";

describe("cleanText / cssColor", () => {
  it("quita comillas y barras sobrantes de los bordes", () => {
    expect(cleanText('\\"Pet Shop\\', "x")).toBe("Pet Shop");
    expect(cleanText('"Pet Shop"', "x")).toBe("Pet Shop");
    expect(cleanText('Pet "Shop" Gualeguay', "x")).toBe('Pet "Shop" Gualeguay'); // el medio no se toca
  });
  it("fallback si queda vacío o no es texto", () => {
    expect(cleanText('""', "Pet Shop")).toBe("Pet Shop");
    expect(cleanText(undefined, "Pet Shop")).toBe("Pet Shop");
  });
  it("color: hex válido o fallback", () => {
    expect(cssColor('"#199f6b"')).toBe("#199f6b");
    expect(cssColor("rojo", "#000000")).toBe("#000000");
  });
});
