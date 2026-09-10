import { describe, it, expect } from "vitest";
import { rateLimit, clientIp } from "./rate-limit.js";

describe("rateLimit", () => {
  it("permite hasta el límite y bloquea el siguiente dentro de la ventana", () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000).ok).toBe(true);
    const blocked = rateLimit(key, 5, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("cuenta por clave de forma independiente", () => {
    const a = `a:${Math.random()}`;
    const b = `b:${Math.random()}`;
    expect(rateLimit(a, 1, 60_000).ok).toBe(true);
    expect(rateLimit(a, 1, 60_000).ok).toBe(false); // a agotada
    expect(rateLimit(b, 1, 60_000).ok).toBe(true); // b intacta
  });

  it("reinicia el cupo cuando la ventana ya venció", () => {
    const key = `w:${Math.random()}`;
    expect(rateLimit(key, 1, 0).ok).toBe(true); // ventana de 0ms → siempre reinicia
    expect(rateLimit(key, 1, 0).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("toma la primera IP de x-forwarded-for", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  it("cae a 'unknown' sin headers de IP", () => {
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
