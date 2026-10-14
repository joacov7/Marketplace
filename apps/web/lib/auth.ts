import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { resolveConfigValue, failureStatus, recordFailures } from "@commerce/platform";
import type { SessionPayload } from "@commerce/platform";
import { db } from "./db";
import { readSession } from "./session";
import { resolveTenant, type ResolvedTenant } from "./tenant";
import { checkDeliveryAccess } from "./delivery-access";
import { clientIp } from "./rate-limit";

/** Roles que abren el panel de administración. */
export const PANEL_ROLES = ["owner", "admin", "merchant_admin"] as const;
const ADMIN_ROLES = new Set<string>(PANEL_ROLES);

/** ¿La sesión tiene un rol de administración del panel? */
export function hasAdminRole(session: SessionPayload | null): boolean {
  return !!session && Array.isArray(session.roles) && session.roles.some((r) => ADMIN_ROLES.has(r.role));
}

/**
 * Comparación en tiempo constante de dos secretos. Evita el side-channel por tiempo de `===`
 * (que corta en el primer byte distinto y filtra información del token). Longitudes distintas →
 * false sin comparar (la longitud no es secreta).
 */
function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Gate de PLATAFORMA por código de servicio: `ADMIN_API_TOKEN` (código maestro: provisioning de
 * comercios, migraciones) o `CRON_SECRET` (crons). Una sesión de usuario NO alcanza: estas rutas
 * no son de un comercio. Las rutas del panel de un comercio usan `panelTenant`.
 */
export function requireServiceToken(envVar: "ADMIN_API_TOKEN" | "CRON_SECRET"): boolean {
  const expected = process.env[envVar];
  return !!expected && safeEqual(providedToken(), expected);
}

/**
 * Acceso a UN comercio desde el panel: el código maestro, o una sesión de admin DE ESE MISMO
 * comercio. Una sesión de admin de otro comercio no alcanza (antes sí: se podía operar otro
 * comercio cambiando `?tenant=`).
 */
export function requireAdminForTenant(tenantId: string): boolean {
  if (requireServiceToken("ADMIN_API_TOKEN")) return true;
  const session = readSession();
  return hasAdminRole(session) && session!.tenantId === tenantId;
}

/**
 * Entrada de las rutas del panel: resuelve el comercio del request (`?tenant=` / subdominio) y
 * exige acceso a ESE comercio. Devuelve el comercio, o la respuesta de error lista para devolver.
 */
export async function panelTenant(req: Request): Promise<{ tenant: ResolvedTenant } | { error: NextResponse }> {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return { error: NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 }) };
  if (!requireAdminForTenant(tenant.tenantId)) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { tenant };
}

/** Lee el código provisto (Bearer o x-service-token) sin compararlo. */
function providedToken(): string | null {
  const h = headers();
  const auth = h.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return bearer ?? h.get("x-service-token");
}

/**
 * Acceso a la pantalla de reparto: código maestro o PIN de reparto del comercio
 * (`ops.deliveryPin`), con bloqueo por intentos fallidos. Ver lib/delivery-access.ts.
 * Devuelve la respuesta de error lista para devolver, o null si puede pasar.
 */
export async function deliveryAccessDenied(req: Request, tenantId: string): Promise<NextResponse | null> {
  const r = await checkDeliveryAccess({
    tenantId,
    ip: clientIp(req),
    provided: providedToken(),
    adminToken: process.env.ADMIN_API_TOKEN,
    loadPin: async () => (await resolveConfigValue<string>(db(), "ops.deliveryPin", { tenantId })).value,
    failures: {
      status: (keys) => failureStatus(db(), keys),
      record: (keys, windowMs) => recordFailures(db(), keys, windowMs),
    },
  });
  if (r.ok) return null;
  if (r.status === 429) {
    return NextResponse.json(
      { error: "Demasiados intentos con un PIN incorrecto. Esperá unos minutos y volvé a probar." },
      { status: 429, headers: { "retry-after": String(r.retryAfterSec ?? 900) } },
    );
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
