import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "../db/port.js";
import { freshDb } from "../db/pglite.testsupport.js";
import { createUser, verifyCredentials, changePassword, resetPanelPassword } from "./users.js";
import { recordFailures, failureStatus, clearFailures } from "./failures.js";

const ADMIN_ROLES = ["owner", "admin", "merchant_admin"];

describe("Contraseñas del panel — cambiar y restablecer", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let otherTenant: string;

  beforeAll(async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    ({ pg, db } = await freshDb([readFileSync(join(here, "..", "db", "migrations", "0021_auth_failures.sql"), "utf8")]));
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('t','T') returning id");
    const [o] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('o','O') returning id");
    tenantId = t!.id;
    otherTenant = o!.id;
    await db.withTenant(tenantId, async (tx) => {
      await createUser(tx, { tenantId, email: "duenio@test.com", password: "clave-vieja-1", role: "owner", scopeType: "tenant", scopeId: tenantId });
      await createUser(tx, { tenantId, email: "cliente@test.com", password: "cliente-123", role: "customer", scopeType: "tenant", scopeId: tenantId });
    });
  });
  afterAll(async () => {
    await pg?.close();
  });

  const login = (email: string, pass: string, t = tenantId) => db.withTenant(t, (tx) => verifyCredentials(tx, email, pass));

  it("cambiar: exige la contraseña actual y un mínimo de 8", async () => {
    const user = (await login("duenio@test.com", "clave-vieja-1"))!;
    expect(await db.withTenant(tenantId, (tx) => changePassword(tx, { userId: user.id, currentPassword: "mal", newPassword: "clave-nueva-1" }))).toEqual({ ok: false, error: "wrong_password" });
    expect(await db.withTenant(tenantId, (tx) => changePassword(tx, { userId: user.id, currentPassword: "clave-vieja-1", newPassword: "corta" }))).toEqual({ ok: false, error: "too_short" });
    expect((await db.withTenant(tenantId, (tx) => changePassword(tx, { userId: user.id, currentPassword: "clave-vieja-1", newPassword: "clave-nueva-1" }))).ok).toBe(true);
    expect(await login("duenio@test.com", "clave-vieja-1")).toBeNull();
    expect(await login("duenio@test.com", "clave-nueva-1")).not.toBeNull();
  });

  it("restablecer: por email, sin la anterior; solo usuarios del panel; no cruza comercios", async () => {
    const r = await db.withTenant(tenantId, (tx) => resetPanelPassword(tx, { email: " DUENIO@test.com ", newPassword: "recuperada-1", adminRoles: ADMIN_ROLES }));
    expect(r.ok).toBe(true);
    expect(await login("duenio@test.com", "recuperada-1")).not.toBeNull();
    // Cuenta de cliente de la tienda: no se toca desde el panel
    expect(await db.withTenant(tenantId, (tx) => resetPanelPassword(tx, { email: "cliente@test.com", newPassword: "hackeada-1", adminRoles: ADMIN_ROLES }))).toEqual({ ok: false, error: "not_panel_user" });
    expect(await login("cliente@test.com", "cliente-123")).not.toBeNull();
    // Inexistente y otro comercio (RLS: no ve el usuario)
    expect(await db.withTenant(tenantId, (tx) => resetPanelPassword(tx, { email: "nadie@test.com", newPassword: "x".repeat(8), adminRoles: ADMIN_ROLES }))).toEqual({ ok: false, error: "not_found" });
    expect(await db.withTenant(otherTenant, (tx) => resetPanelPassword(tx, { email: "duenio@test.com", newPassword: "otro-comercio-1", adminRoles: ADMIN_ROLES }))).toEqual({ ok: false, error: "not_found" });
    expect(await login("duenio@test.com", "recuperada-1")).not.toBeNull();
  });

  it("clearFailures destraba un email bloqueado", async () => {
    await db.tx(async (tx) => {
      await recordFailures(tx, ["login-fail:email:x"], 60_000);
      expect(await failureStatus(tx, ["login-fail:email:x"])).toHaveLength(1);
      await clearFailures(tx, ["login-fail:email:x"]);
      expect(await failureStatus(tx, ["login-fail:email:x"])).toEqual([]);
    });
  });
});
