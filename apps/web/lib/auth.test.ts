import { describe, it, expect, vi, beforeEach } from "vitest";

// Contexto de request de Next simulado: cabeceras (código) + cookie de sesión.
let reqHeaders = new Headers();
let sessionCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: () => reqHeaders,
  cookies: () => ({ get: (name: string) => (name === "session" && sessionCookie ? { value: sessionCookie } : undefined) }),
}));
// Dos comercios: el slug del ?tenant= decide cuál se resuelve.
vi.mock("./tenant", () => ({
  resolveTenant: async (slug?: string | null) =>
    slug === "a" ? { tenantId: "tenant-a", slug: "a", name: "A" } : slug === "b" ? { tenantId: "tenant-b", slug: "b", name: "B" } : null,
}));
vi.mock("./db", () => ({ db: () => ({}) }));

const MASTER = "codigo-maestro-de-prueba-0123456789";
process.env.ADMIN_API_TOKEN = MASTER;
process.env.CRON_SECRET = "cron-de-prueba";
process.env.SESSION_SECRET = "secreto-de-sesion-de-prueba-0123456789";

const { panelTenant, requireServiceToken } = await import("./auth.js");
const { buildSessionToken } = await import("./session.js");

const adminOf = (tenantId: string) =>
  buildSessionToken({ id: "u1", email: "duenio@test.com", roles: [{ role: "owner", scopeType: "tenant", scopeId: tenantId }] }, tenantId);
const req = (tenant: string) => new Request(`https://x.test/api/merchant/orders?tenant=${tenant}`);

describe("panelTenant — acceso a UN comercio", () => {
  beforeEach(() => {
    reqHeaders = new Headers();
    sessionCookie = undefined;
  });

  it("sesión de admin de A entra a A", async () => {
    sessionCookie = adminOf("tenant-a");
    const r = await panelTenant(req("a"));
    expect("tenant" in r && r.tenant.tenantId).toBe("tenant-a");
  });

  it("sesión de admin de A NO entra a B (antes sí)", async () => {
    sessionCookie = adminOf("tenant-a");
    const r = await panelTenant(req("b"));
    expect("error" in r && r.error.status).toBe(401);
  });

  it("sesión de cliente (no admin) no entra", async () => {
    sessionCookie = buildSessionToken({ id: "c1", email: "c@test.com", roles: [{ role: "customer", scopeType: "tenant", scopeId: "tenant-a" }] }, "tenant-a");
    const r = await panelTenant(req("a"));
    expect("error" in r && r.error.status).toBe(401);
  });

  it("el código maestro entra a cualquier comercio; sin nada → 401; comercio inexistente → 400", async () => {
    reqHeaders = new Headers({ authorization: `Bearer ${MASTER}` });
    expect("tenant" in (await panelTenant(req("b")))).toBe(true);
    reqHeaders = new Headers();
    const none = await panelTenant(req("a"));
    expect("error" in none && none.error.status).toBe(401);
    const missing = await panelTenant(req("zzz"));
    expect("error" in missing && missing.error.status).toBe(400);
  });
});

describe("requireServiceToken — solo códigos de servicio", () => {
  beforeEach(() => {
    reqHeaders = new Headers();
    sessionCookie = undefined;
  });

  it("una sesión de admin NO habilita rutas de plataforma (crear comercios, migrar)", () => {
    sessionCookie = adminOf("tenant-a");
    expect(requireServiceToken("ADMIN_API_TOKEN")).toBe(false);
  });

  it("el código correcto sí; el del cron no sirve como maestro", () => {
    reqHeaders = new Headers({ authorization: `Bearer ${MASTER}` });
    expect(requireServiceToken("ADMIN_API_TOKEN")).toBe(true);
    reqHeaders = new Headers({ authorization: "Bearer cron-de-prueba" });
    expect(requireServiceToken("ADMIN_API_TOKEN")).toBe(false);
    expect(requireServiceToken("CRON_SECRET")).toBe(true);
  });
});
