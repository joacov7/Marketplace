import { describe, it, expect } from "vitest";
import { sealSecret, openSecret } from "./secretbox.js";

const KEY = "una-clave-de-plataforma-larga-de-prueba-123456";

describe("secretbox — cifrado de secretos en la base", () => {
  it("ida y vuelta, sin dejar el secreto en claro", () => {
    const sealed = sealSecret("APP_USR-123-secreto", KEY);
    expect(sealed).not.toContain("APP_USR");
    expect(sealed.startsWith("v1$")).toBe(true);
    expect(openSecret(sealed, KEY)).toBe("APP_USR-123-secreto");
  });

  it("nonce aleatorio: el mismo secreto cifra distinto cada vez", () => {
    expect(sealSecret("x", KEY)).not.toBe(sealSecret("x", KEY));
  });

  it("falla con otra clave o si el texto fue alterado", () => {
    const sealed = sealSecret("secreto", KEY);
    expect(() => openSecret(sealed, KEY + "-otra")).toThrow(/secretbox_cannot_open/);
    const parts = sealed.split("$");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("otra cosa").toString("base64")].join("$");
    expect(() => openSecret(tampered, KEY)).toThrow(/secretbox_cannot_open/);
  });

  it("exige una clave larga", () => {
    expect(() => sealSecret("x", "corta")).toThrow(/secretbox_key_too_short/);
  });
});
