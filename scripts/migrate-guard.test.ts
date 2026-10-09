import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrationDecision } from "./migrate-guard.mjs";

const URL_ENV = { DATABASE_URL: "postgres://u:p@127.0.0.1:1/db" };

describe("migrationDecision — quién puede migrar la base", () => {
  it("deploy de producción en Vercel → migra", () => {
    expect(migrationDecision({ deploy: true, env: { ...URL_ENV, VERCEL: "1", VERCEL_ENV: "production" } }).action).toBe("run");
  });

  it("deploy de Preview → NO migra aunque tenga DATABASE_URL", () => {
    const d = migrationDecision({ deploy: true, env: { ...URL_ENV, VERCEL: "1", VERCEL_ENV: "preview" } });
    expect(d.action).toBe("skip");
    expect(d.reason).toMatch(/preview/);
  });

  it("deploy de development (vercel dev) → NO migra", () => {
    expect(migrationDecision({ deploy: true, env: { ...URL_ENV, VERCEL: "1", VERCEL_ENV: "development" } }).action).toBe("skip");
  });

  it("valor de VERCEL_ENV desconocido → NO migra (solo 'production' habilita)", () => {
    expect(migrationDecision({ deploy: true, env: { ...URL_ENV, VERCEL: "1", VERCEL_ENV: "Production " } }).action).toBe("skip");
  });

  it("en Vercel sin VERCEL_ENV → falla el build (no adivina)", () => {
    expect(migrationDecision({ deploy: true, env: { ...URL_ENV, VERCEL: "1" } }).action).toBe("fail");
  });

  it("build local (fuera de Vercel) con DATABASE_URL → NO migra", () => {
    expect(migrationDecision({ deploy: true, env: { ...URL_ENV } }).action).toBe("skip");
  });

  it("producción sin DATABASE_URL → salta (como antes)", () => {
    expect(migrationDecision({ deploy: true, env: { VERCEL: "1", VERCEL_ENV: "production" } }).action).toBe("skip");
  });

  it("corrida manual (npm run migrate) con DATABASE_URL → migra; sin URL → salta", () => {
    expect(migrationDecision({ deploy: false, env: { ...URL_ENV } }).action).toBe("run");
    expect(migrationDecision({ deploy: false, env: {} }).action).toBe("skip");
  });
});

/**
 * El script REAL como subproceso. La base es inalcanzable (127.0.0.1:1): si el script decide
 * migrar, intenta conectar y falla ("Conexión falló"); si decide no migrar, sale 0 sin
 * intentarlo. Nunca toca una base de verdad.
 */
describe("scripts/migrate-prod.mjs — comportamiento por entorno", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "migrate-prod.mjs");
  const base = { PATH: process.env.PATH ?? "", ...URL_ENV };
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 60_000 });

  it("Preview: sale 0 sin conectarse a la base", () => {
    const r = run(["--deploy"], { ...base, VERCEL: "1", VERCEL_ENV: "preview" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no es producción/);
    expect(r.stdout + r.stderr).not.toMatch(/Conexión falló/);
  });

  it("build local: sale 0 sin conectarse a la base", () => {
    const r = run(["--deploy"], { ...base });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Conexión falló/);
  });

  it("Vercel sin VERCEL_ENV: sale 1 sin conectarse a la base", () => {
    const r = run(["--deploy"], { ...base, VERCEL: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/VERCEL_ENV/);
    expect(r.stdout + r.stderr).not.toMatch(/Conexión falló/);
  });

  it("producción: intenta conectarse para migrar (y falla acá porque la base es inalcanzable)", () => {
    const r = run(["--deploy"], { ...base, VERCEL: "1", VERCEL_ENV: "production" });
    expect(r.stdout).toMatch(/Deploy de producción/);
    expect(r.stdout).toMatch(/Conexión falló/);
    expect(r.status).not.toBe(0);
  }, 60_000);
});
