import { describe, it, expect } from "vitest";
import { tenantSlugFromHost } from "./tenant-slug.js";

describe("tenantSlugFromHost — resolución de tenant en el borde", () => {
  it("toma el subdominio como slug", () => {
    expect(tenantSlugFromHost("gualeguay.midominio.com", null)).toBe("gualeguay");
    expect(tenantSlugFromHost("gualeguay.midominio.com:443", null)).toBe("gualeguay");
  });

  it("el override de header gana (dev)", () => {
    expect(tenantSlugFromHost("cualquier.cosa.com", "otro")).toBe("otro");
  });

  it("dominio raíz o localhost sin subdominio → null (falla cerrado)", () => {
    expect(tenantSlugFromHost("midominio.com", null)).toBe(null);
    expect(tenantSlugFromHost("localhost", null)).toBe(null);
    expect(tenantSlugFromHost("www.midominio.com", null)).toBe(null);
  });

  it("soporta *.localhost para desarrollo", () => {
    expect(tenantSlugFromHost("gualeguay.localhost:3000", null)).toBe("gualeguay");
  });

  it("host vacío → null", () => {
    expect(tenantSlugFromHost(null, null)).toBe(null);
  });
});
