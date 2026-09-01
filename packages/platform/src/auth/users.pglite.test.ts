import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../db/pglite.testsupport.js";
import type { TenantAwareDb } from "../db/port.js";
import { createUser, verifyCredentials, getUser } from "./users.js";

describe("Users — alta y verificación de credenciales (por tenant, RLS)", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
    const [a] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('a','A') returning id");
    const [b] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('b','B') returning id");
    tenantA = a!.id;
    tenantB = b!.id;
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("crea un cliente y verifica sus credenciales", async () => {
    const res = await db.withTenant(tenantA, (tx) =>
      createUser(tx, { tenantId: tenantA, email: "Juan@Mail.com", password: "clave123", role: "customer", scopeType: "tenant", scopeId: tenantA }),
    );
    expect(res.ok).toBe(true);

    const okLogin = await db.withTenant(tenantA, (tx) => verifyCredentials(tx, "juan@mail.com", "clave123"));
    expect(okLogin?.roles[0]?.role).toBe("customer");
    const badLogin = await db.withTenant(tenantA, (tx) => verifyCredentials(tx, "juan@mail.com", "malaclave"));
    expect(badLogin).toBeNull();
  });

  it("email único por tenant, pero el mismo email puede existir en otro tenant", async () => {
    const first = await db.withTenant(tenantA, (tx) =>
      createUser(tx, { tenantId: tenantA, email: "dup@mail.com", password: "x", role: "customer", scopeType: "tenant", scopeId: tenantA }),
    );
    expect(first.ok).toBe(true);
    const dupSameTenant = await db.withTenant(tenantA, (tx) =>
      createUser(tx, { tenantId: tenantA, email: "dup@mail.com", password: "y", role: "customer", scopeType: "tenant", scopeId: tenantA }),
    );
    expect(dupSameTenant.ok).toBe(false);
    if (!dupSameTenant.ok) expect(dupSameTenant.error).toBe("email_taken");
    // mismo email en OTRO tenant: permitido
    const otherTenant = await db.withTenant(tenantB, (tx) =>
      createUser(tx, { tenantId: tenantB, email: "dup@mail.com", password: "z", role: "customer", scopeType: "tenant", scopeId: tenantB }),
    );
    expect(otherTenant.ok).toBe(true);
  });

  it("un tenant no ve los usuarios de otro (RLS)", async () => {
    const created = await db.withTenant(tenantA, (tx) =>
      createUser(tx, { tenantId: tenantA, email: "solo-a@mail.com", password: "x", role: "customer", scopeType: "tenant", scopeId: tenantA }),
    );
    if (!created.ok) throw new Error(created.error);
    // desde el tenant B, ese usuario no existe
    const seenFromB = await db.withTenant(tenantB, (tx) => getUser(tx, created.value.userId));
    expect(seenFromB).toBeNull();
  });
});
