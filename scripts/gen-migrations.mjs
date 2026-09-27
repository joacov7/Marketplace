// Genera apps/web/lib/migrations.generated.ts embebiendo el SQL de las migraciones,
// para poder correrlas desde un route handler en Vercel (sin leer archivos en runtime).
// Regenerar tras cambiar cualquier migración: node scripts/gen-migrations.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { MIGRATION_FILES } from "./migrations-list.mjs";

const entries = MIGRATION_FILES
  .map(([name, path]) => `  { name: ${JSON.stringify(name)}, sql: ${JSON.stringify(readFileSync(path, "utf8"))} },`)
  .join("\n");

const out = `// GENERADO por scripts/gen-migrations.mjs — NO editar a mano.
// SQL de las migraciones embebido para correrlas desde /api/admin/migrate en Vercel.
export const MIGRATIONS: { name: string; sql: string }[] = [
${entries}
];
`;

writeFileSync("apps/web/lib/migrations.generated.ts", out);
console.log("apps/web/lib/migrations.generated.ts generado con", MIGRATION_FILES.length, "migraciones");
