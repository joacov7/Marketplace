import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { claimCheckout, completeCheckout, recordCheckoutOrder, releaseCheckout } from "./idempotency.js";

describe("idempotencia del checkout", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let otherTenant: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId } = await seedTenantMerchant(db));
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('o','O') returning id");
    otherTenant = t!.id;
  });
  afterAll(async () => {
    await pg?.close();
  });

  const claim = (key: string, requestHash = "h1", tid = tenantId) =>
    db.withTenant(tid, (tx) => claimCheckout(tx, { tenantId: tid, key, requestHash }));

  it("primera vez es nueva; el reintento mientras corre está en curso; terminado devuelve lo mismo", async () => {
    expect(await claim("k-aaaaaaaa")).toEqual({ kind: "new" });
    expect(await claim("k-aaaaaaaa")).toEqual({ kind: "in_progress" });
    const body = { orderId: "11111111-1111-1111-1111-111111111111", totalMinor: "1500", petName: "Bruno" };
    await db.withTenant(tenantId, (tx) => completeCheckout(tx, "k-aaaaaaaa", 201, body));
    expect(await claim("k-aaaaaaaa")).toEqual({ kind: "replay", status: 201, body });
  });

  it("misma clave con otro contenido → mismatch (no se reusa la respuesta de otro carrito)", async () => {
    expect(await claim("k-aaaaaaaa", "otro-hash")).toEqual({ kind: "mismatch" });
  });

  it("si el intento falla, la clave se libera y se puede reintentar", async () => {
    expect(await claim("k-bbbbbbbb")).toEqual({ kind: "new" });
    await db.withTenant(tenantId, (tx) => releaseCheckout(tx, "k-bbbbbbbb"));
    expect(await claim("k-bbbbbbbb")).toEqual({ kind: "new" });
  });

  it("dos requests simultáneas con la misma clave: solo una queda como dueña", async () => {
    const results = await Promise.all([claim("k-cccccccc"), claim("k-cccccccc"), claim("k-cccccccc")]);
    expect(results.filter((r) => r.kind === "new")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "in_progress")).toHaveLength(2);
  });

  it("un reclamo abandonado (sin pedido) se puede retomar; con pedido creado, no", async () => {
    expect(await claim("k-dddddddd")).toEqual({ kind: "new" });
    expect(await claim("k-eeeeeeee")).toEqual({ kind: "new" });
    await db.withTenant(tenantId, (tx) => recordCheckoutOrder(tx, "k-eeeeeeee", "22222222-2222-2222-2222-222222222222"));
    await db.withTenant(tenantId, (tx) =>
      tx.query(`update checkout_requests set created_at = now() - interval '5 minutes' where idempotency_key in ('k-dddddddd','k-eeeeeeee')`),
    );
    expect(await claim("k-dddddddd")).toEqual({ kind: "new" });
    expect(await claim("k-eeeeeeee")).toEqual({ kind: "in_progress" }); // no duplica el pedido
  });

  it("aislado por tenant: la misma clave en otro comercio es independiente", async () => {
    expect(await claim("k-aaaaaaaa", "h1", otherTenant)).toEqual({ kind: "new" });
  });

  it("borra filas de más de 7 días al reclamar", async () => {
    await db.withTenant(tenantId, (tx) =>
      tx.query(`update checkout_requests set created_at = now() - interval '8 days' where idempotency_key = 'k-aaaaaaaa'`),
    );
    expect(await claim("k-ffffffff")).toEqual({ kind: "new" });
    const left = await db.withTenant(tenantId, (tx) =>
      tx.query(`select 1 from checkout_requests where idempotency_key = 'k-aaaaaaaa'`),
    );
    expect(left).toHaveLength(0);
  });
});
