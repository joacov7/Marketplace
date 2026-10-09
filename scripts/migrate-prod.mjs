// Aplica las migraciones pendientes contra la base, en el DEPLOY (postbuild de apps/web).
// Seguro y automático:
//   - Con --deploy (postbuild) SOLO migra en el deploy de producción de Vercel
//     (VERCEL_ENV=production); las Preview y los builds locales no tocan la base.
//     Ver scripts/migrate-guard.mjs. Sin --deploy (`npm run migrate`) es una corrida manual.
//   - Trackea qué migración se aplicó (tabla schema_migrations): solo corre las nuevas.
//   - Toma un lock de Postgres (pg_advisory_lock): dos deploys a la vez no se pisan.
//   - Sin DATABASE_URL (p. ej. un preview sin base) → NO hace nada y sale OK (no rompe el build).
//   - Si una migración FALLA de verdad → sale con error y el deploy no se promociona
//     (mejor bloquear un deploy roto que servir una base a medias).
// No siembra datos de demo: eso quedó solo en el botón manual del panel (?seed=).
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MIGRATION_FILES } from "./migrations-list.mjs";
import { migrationDecision } from "./migrate-guard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_KEY = 8274529; // clave arbitraria y estable para el advisory lock de migraciones
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const decision = migrationDecision({ deploy: process.argv.includes("--deploy"), env: process.env });
if (decision.action === "fail") {
  console.error(`[migrate] ERROR: ${decision.reason}`);
  process.exit(1);
}
if (decision.action === "skip") {
  console.log(`[migrate] ${decision.reason}`);
  process.exit(0);
}
console.log(`[migrate] ${decision.reason}`);

async function connect(retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 });
    try {
      await sql`select 1`;
      return sql;
    } catch (e) {
      lastErr = e;
      await sql.end().catch(() => {});
      console.log(`[migrate] Conexión falló (intento ${i + 1}/${retries}); reintento…`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

const sql = await connect();
let locked = false;
try {
  await sql`select pg_advisory_lock(${LOCK_KEY})`;
  locked = true;

  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));

  const pending = MIGRATION_FILES.filter(([name]) => !done.has(name));
  if (pending.length === 0) {
    console.log("[migrate] Base al día — nada que aplicar.");
  } else {
    console.log(`[migrate] Aplicando ${pending.length} migración(es) nueva(s)…`);
    for (const [name, rel] of pending) {
      const text = readFileSync(join(REPO_ROOT, rel), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (name) values (${name}) on conflict do nothing`;
      });
      console.log(`[migrate]   ✓ ${name}`);
    }
    console.log("[migrate] Listo.");
  }
} catch (e) {
  console.error("[migrate] ERROR aplicando migraciones:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  if (locked) await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  await sql.end().catch(() => {});
}
