import { describe, it, expect } from "vitest";
import { generatePost, themeForDate, normalizeHashtags, postToText } from "./content.js";
import type { GeneratePostInput } from "./types.js";

const brand = { store: "PetShop Gualeguay", primaryColor: "#0a7d4b", secondaryColor: "#f4b400", handle: "@petshop", phone: "3446-000000" };

function base(overrides: Partial<GeneratePostInput> = {}): GeneratePostInput {
  return {
    date: new Date("2026-09-14T12:00:00Z"), // lunes
    schedule: { "1": "tip", "2": "producto", "4": "oferta", "5": "suscripcion", "0": "calido", "6": "calido", "3": "testimonio" },
    templates: {
      tip: [
        { title: "Cuánto come tu mascota", body: "Te ayudamos a calcularlo en {store}." },
        { title: "El agua también cuida", body: "Siempre agua fresca. — {store}" },
      ],
      producto: [{ title: "{product}", body: "Ya en {store} por {price}. Pedí por {handle}." }],
      suscripcion: [{ title: "Nunca te quedes sin alimento", body: "Suscribite en {store} y ahorrá {discount}." }],
      calido: [{ title: "Feliz finde 🐾", body: "De parte de {store}." }],
    },
    hashtags: ["mascotas", "#petshop", " envios "],
    brand,
    products: [
      { name: "Alimento Excellent Adulto 15kg", priceLabel: "$28.500", category: "Alimentos" },
      { name: "Arena sanitaria 10kg", priceLabel: "$9.900", category: "Gatos" },
    ],
    subscriptionDiscountPercent: 10,
    ...overrides,
  };
}

describe("themeForDate", () => {
  it("usa el calendario del tenant por día de semana", () => {
    expect(themeForDate({ "1": "tip" }, new Date("2026-09-14T00:00:00Z"))).toBe("tip"); // lunes
  });
  it("cae en 'calido' cuando el día no está en el calendario", () => {
    expect(themeForDate({}, new Date("2026-09-14T00:00:00Z"))).toBe("calido");
  });
});

describe("generatePost", () => {
  it("es determinista: misma fecha → mismo post", () => {
    const a = generatePost(base());
    const b = generatePost(base());
    expect(a).toEqual(b);
  });

  it("deriva el tema del calendario y rellena {store}", () => {
    const p = generatePost(base());
    expect(p.theme).toBe("tip");
    expect(p.title.length).toBeGreaterThan(0);
    expect(`${p.title} ${p.body}`).toContain("PetShop Gualeguay");
  });

  it("rota de variante con `variant` y respeta variantCount", () => {
    const v0 = generatePost(base({ variant: 0 }));
    const v1 = generatePost(base({ variant: 1 }));
    expect(v0.variantCount).toBe(2);
    expect(v0.title).not.toBe(v1.title);
  });

  it("inyecta un producto real en temas de producto/oferta", () => {
    const p = generatePost(base({ theme: "producto" }));
    expect(p.product).not.toBeNull();
    expect(p.title).toBe(p.product!.name);
    expect(p.body).toContain(p.product!.priceLabel!);
    expect(p.body).toContain("@petshop");
  });

  it("no deja tokens sin reemplazar", () => {
    for (const theme of ["tip", "producto", "suscripcion", "calido"] as const) {
      const p = generatePost(base({ theme }));
      expect(`${p.title} ${p.body}`).not.toMatch(/\{\w+\}/);
    }
  });

  it("reemplaza {discount} con el % configurado", () => {
    const p = generatePost(base({ theme: "suscripcion" }));
    expect(p.body).toContain("10%");
  });

  it("degrada sin romperse si no hay plantilla para el tema", () => {
    const p = generatePost(base({ theme: "testimonio" }));
    expect(p.theme).toBe("testimonio");
    expect(p.variantCount).toBe(0);
    expect(typeof p.title).toBe("string");
  });
});

describe("normalizeHashtags", () => {
  it("agrega #, quita espacios, vacíos y duplicados", () => {
    expect(normalizeHashtags(["mascotas", "#Mascotas", " petshop ", "", "  "])).toEqual(["#mascotas", "#petshop"]);
  });
});

describe("postToText", () => {
  it("arma título + cuerpo + hashtags para copiar", () => {
    const text = postToText(generatePost(base()));
    expect(text).toContain("PetShop Gualeguay");
    expect(text).toContain("#mascotas");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });
});
