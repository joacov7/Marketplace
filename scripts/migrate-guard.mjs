// Decide si el runner de migraciones debe tocar la base. Función PURA (solo lee el env que
// recibe) para poder probarla sin base de datos.
//
// Dos formas de invocar scripts/migrate-prod.mjs:
//   - MANUAL (`npm run migrate`, sin --deploy): la corre una persona a propósito contra la base
//     que puso en DATABASE_URL → se respeta.
//   - DEPLOY (`--deploy`, desde el postbuild de apps/web): SOLO migra en el deploy de
//     PRODUCCIÓN de Vercel (VERCEL_ENV=production). Las Preview y los builds locales NO migran,
//     aunque tengan DATABASE_URL (en Vercel, la de Preview puede apuntar a la base real).
//
// Si en Vercel no se puede saber el entorno (falta VERCEL_ENV), se FALLA el build en vez de
// adivinar: migrar podría tocar producción desde una Preview, y saltear en silencio dejaría un
// deploy de producción con el esquema viejo.

/**
 * @param {{ deploy: boolean, env: Record<string, string | undefined> }} input
 * @returns {{ action: "run" | "skip" | "fail", reason: string }}
 */
export function migrationDecision({ deploy, env }) {
  const hasUrl = Boolean(env.DATABASE_URL || env.POSTGRES_URL);

  if (deploy) {
    const vercelEnv = env.VERCEL_ENV;
    if (!vercelEnv) {
      if (env.VERCEL === "1") {
        return {
          action: "fail",
          reason: "Build en Vercel sin VERCEL_ENV: no se puede saber si es producción o Preview. No migro.",
        };
      }
      return { action: "skip", reason: "Build fuera de Vercel (local): las migraciones de deploy solo corren en producción." };
    }
    if (vercelEnv !== "production") {
      return { action: "skip", reason: `Entorno "${vercelEnv}" (no es producción): no se migra la base.` };
    }
  }

  if (!hasUrl) {
    return { action: "skip", reason: "Sin DATABASE_URL/POSTGRES_URL — salto migraciones (build sin base)." };
  }
  return { action: "run", reason: deploy ? "Deploy de producción (VERCEL_ENV=production)." : "Ejecución manual." };
}
