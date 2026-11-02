import { describe, it, expect } from "vitest";
import { getConfigKeyDef } from "@commerce/platform";
import { STORE_THEMES, THEME_IDS, isThemeId, storeTheme } from "./store-themes";

describe("estilos de la tienda", () => {
  it("todos definen exactamente las mismas variables (si falta una, esa parte se ve rota)", () => {
    const keys = Object.keys(STORE_THEMES.clasico.vars).sort();
    for (const id of THEME_IDS) expect(Object.keys(STORE_THEMES[id].vars).sort()).toEqual(keys);
  });

  it("la lista coincide con los valores que acepta la config branding.theme", () => {
    const def = getConfigKeyDef("branding.theme");
    expect((def?.jsonSchema as { enum?: string[] }).enum).toEqual([...THEME_IDS]);
    expect(def?.defaultValue).toBe("clasico");
  });

  it("acento sugerido válido y fuentes de Google", () => {
    for (const id of THEME_IDS) {
      expect(STORE_THEMES[id].accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(STORE_THEMES[id].fontsHref.startsWith("https://fonts.googleapis.com/css2?")).toBe(true);
    }
  });

  it("valor desconocido o vacío cae en clásico", () => {
    expect(isThemeId("barrio")).toBe(true);
    expect(isThemeId("otro")).toBe(false);
    expect(storeTheme(undefined).id).toBe("clasico");
    expect(storeTheme("x").id).toBe("clasico");
  });
});
