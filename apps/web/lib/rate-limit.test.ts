import { describe, it, expect } from "vitest";
import { clientIp } from "./rate-limit.js";

describe("clientIp", () => {
  it("toma la primera IP de x-forwarded-for", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });
  it("cae a 'unknown' sin headers de IP", () => {
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
