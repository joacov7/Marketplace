import { headers } from "next/headers";

/**
 * Auth mínima para F1. Las rutas de plataforma (provisioning, crons) se protegen con un
 * token de servicio (`ADMIN_API_TOKEN` / `CRON_SECRET`). La auth de usuarios finales y
 * staff (sesión + MFA para admins) se integra en un paso siguiente con un proveedor
 * (Clerk/Auth0/NextAuth); acá queda el punto de enganche y el gate de servicio.
 *
 * NOTA: esto NO es todavía RBAC completo por usuario; es el gate de operaciones de
 * plataforma. Ver docs/fase-0/08-seguridad-testing.md.
 */
export function requireServiceToken(envVar: "ADMIN_API_TOKEN" | "CRON_SECRET"): boolean {
  const expected = process.env[envVar];
  if (!expected) return false;
  const h = headers();
  const auth = h.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? h.get("x-service-token");
  return provided === expected;
}
