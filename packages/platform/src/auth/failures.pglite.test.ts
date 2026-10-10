import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "../db/port.js";
import { freshDb } from "../db/pglite.testsupport.js";
import { failureStatus, recordFailures, purgeExpiredFailures, consumeRateLimit } from "./failures.js";

describe("auth_failures — contador compartido de intentos fallidos", () => {
  let pg: PGlite;
  let db: TenantAwareDb;

  beforeAll(async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    ({ pg, db } = await freshDb([readFileSync(join(here, "..", "db", "migrations", "0021_auth_failures.sql"), "utf8")]));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("consultar no suma; registrar suma por clave; el rol de la app puede usarlo", async () => {
    await db.tx(async (tx) => {
      expect(await failureStatus(tx, ["a", "b"])).toEqual([]);
      await recordFailures(tx, ["a", "b"], 60_000);
      await recordFailures(tx, ["a"], 60_000);
      const st = await failureStatus(tx, ["a", "b", "c"]);
      expect(Object.fromEntries(st.map((s) => [s.key, s.count]))).toEqual({ a: 2, b: 1 });
      expect(st.every((s) => s.retryAfterMs > 0 && s.retryAfterMs <= 60_000)).toBe(true);
      expect(await failureStatus(tx, ["a"])).toHaveLength(1);
    });
  });

  it("la ventana no se estira con más fallos y, vencida, reinicia en 1", async () => {
    await db.tx(async (tx) => {
      await recordFailures(tx, ["w"], 60_000);
      const [first] = await tx.query<{ reset_at: string }>("select reset_at::text from auth_failures where key = 'w'");
      await recordFailures(tx, ["w"], 60_000);
      const [second] = await tx.query<{ reset_at: string }>("select reset_at::text from auth_failures where key = 'w'");
      expect(second!.reset_at).toBe(first!.reset_at);

      await tx.query("update auth_failures set reset_at = now() - interval '1 second' where key = 'w'");
      expect(await failureStatus(tx, ["w"])).toEqual([]); // vencido = 0
      await recordFailures(tx, ["w"], 60_000);
      expect((await failureStatus(tx, ["w"]))[0]!.count).toBe(1);
    });
  });

  it("purga solo los vencidos", async () => {
    await db.tx(async (tx) => {
      await recordFailures(tx, ["vieja", "nueva"], 60_000);
      await tx.query("update auth_failures set reset_at = now() - interval '1 day' where key = 'vieja'");
      expect(await purgeExpiredFailures(tx)).toBeGreaterThanOrEqual(1);
      const keys = (await tx.query<{ key: string }>("select key from auth_failures")).map((r) => r.key);
      expect(keys).toContain("nueva");
      expect(keys).not.toContain("vieja");
    });
  });

  it("consumeRateLimit: deja pasar hasta el límite, después bloquea y vence la ventana", async () => {
    await db.tx(async (tx) => {
      for (let i = 1; i <= 3; i++) expect(await consumeRateLimit(tx, "rl", 3, 60_000)).toMatchObject({ ok: true, count: i });
      const blocked = await consumeRateLimit(tx, "rl", 3, 60_000);
      expect(blocked.ok).toBe(false);
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
      await tx.query("update auth_failures set reset_at = now() - interval '1 second' where key = 'rl'");
      expect(await consumeRateLimit(tx, "rl", 3, 60_000)).toMatchObject({ ok: true, count: 1 });
    });
  });
});
