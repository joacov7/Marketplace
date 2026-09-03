import { headers } from "next/headers";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "./db";

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

/** Lee el código provisto (Bearer o x-service-token) sin compararlo. */
function providedToken(): string | null {
  const h = headers();
  const auth = h.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return bearer ?? h.get("x-service-token");
}

/**
 * Acceso a la pantalla de reparto: lo abre el token de admin (el comercio) O el PIN de reparto
 * del tenant (`ops.deliveryPin`, config, nunca hardcodeado), pensado para el repartidor sin
 * darle la llave del panel. Si el tenant no tiene PIN configurado, solo el token de admin abre.
 */
export async function requireDeliveryAccess(tenantId: string): Promise<boolean> {
  const provided = providedToken();
  if (!provided) return false;
  const admin = process.env.ADMIN_API_TOKEN;
  if (admin && provided === admin) return true;
  const pin = (await resolveConfigValue<string>(db(), "ops.deliveryPin", { tenantId })).value;
  return typeof pin === "string" && pin.length > 0 && provided === pin;
}
