import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
import { signSession, verifySession, SESSION_TTL_MS, type SessionPayload } from "./session.js";

describe("Password hashing (scrypt)", () => {
  it("verifica la contraseña correcta y rechaza la incorrecta", () => {
    const h = hashPassword("secreto-123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("secreto-123", h)).toBe(true);
    expect(verifyPassword("otra", h)).toBe(false);
  });

  it("dos hashes de la misma contraseña difieren (salt) pero ambos verifican", () => {
    const a = hashPassword("x");
    const b = hashPassword("x");
    expect(a).not.toBe(b);
    expect(verifyPassword("x", a) && verifyPassword("x", b)).toBe(true);
  });
});

describe("Session firmada (HMAC)", () => {
  const secret = "super-secreto";
  const payload: SessionPayload = {
    userId: "u1",
    tenantId: "t1",
    email: "a@b.com",
    roles: [{ role: "customer", scopeType: "tenant", scopeId: "t1" }],
    exp: Date.now() + SESSION_TTL_MS,
  };

  it("firma y verifica un token válido", () => {
    const token = signSession(payload, secret);
    const out = verifySession(token, secret);
    expect(out?.userId).toBe("u1");
    expect(out?.email).toBe("a@b.com");
  });

  it("rechaza firma inválida (secreto distinto o token manipulado)", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, "otro")).toBeNull();
    expect(verifySession(token.slice(0, -2) + "xx", secret)).toBeNull();
  });

  it("rechaza sesión expirada", () => {
    const expired = signSession({ ...payload, exp: Date.now() - 1000 }, secret);
    expect(verifySession(expired, secret)).toBeNull();
  });
});
