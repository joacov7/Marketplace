import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { DomainEvent } from "@commerce/contracts";
import { freshDb } from "../db/pglite.testsupport.js";
import type { TenantAwareDb } from "../db/port.js";
import { enqueueEvent, drainOutbox } from "./outbox.js";

describe("Outbox transaccional", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshDb());
    const [t] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('t','T') returning id");
    tenantId = t!.id;
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("enqueue dentro de una tx de tenant + drain publica y marca published (idempotente)", async () => {
    await db.withTenant(tenantId, async (tx) => {
      await enqueueEvent(tx, { tenantId, type: "order.confirmed", payload: { orderId: "o1" } });
      await enqueueEvent(tx, { tenantId, type: "payment.captured", payload: { orderId: "o1" } });
    });

    const published: DomainEvent[] = [];
    const n1 = await drainOutbox(db, async (e) => { published.push(e); });
    expect(n1).toBe(2);
    expect(published.map((e) => e.type).sort()).toEqual(["order.confirmed", "payment.captured"]);
    expect(published[0]!.payload).toEqual({ orderId: "o1" });

    // segundo drain no republica nada (ya están published)
    const n2 = await drainOutbox(db, async () => {});
    expect(n2).toBe(0);
  });

  it("si la tx del cambio de estado hace rollback, el evento no queda (no dual-write)", async () => {
    await expect(
      db.withTenant(tenantId, async (tx) => {
        await enqueueEvent(tx, { tenantId, type: "order.created", payload: { orderId: "o2" } });
        throw new Error("boom"); // fuerza rollback
      }),
    ).rejects.toThrow("boom");

    const n = await drainOutbox(db, async () => {});
    expect(n).toBe(0); // el evento de o2 nunca se persistió
  });
});
