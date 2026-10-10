import { NextResponse } from "next/server";
import { consumeRateLimit, failureStatus, recordFailures } from "@commerce/platform";
import { normalizePhone } from "@commerce/modules/customer";
import { db } from "./db";
import { clientIp } from "./rate-limit";

/**
 * Límites contra abuso de endpoints públicos (bots, fuerza bruta, gasto de IA). Los contadores
 * viven en Postgres (tabla auth_failures) para que valgan en TODAS las rutas e instancias de
 * Vercel; uno en memoria lo esquiva cualquiera repartiendo pedidos.
 *
 * Si el contador falla (p. ej. la base no responde), se DEJA PASAR y se registra el error: un
 * problema del limitador no debe tirar el checkout. La base caída igual corta la ruta después.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface Rule {
  key: string;
  limit: number;
  windowMs: number;
}

/** Límites por ruta. Pensados para un comercio chico: holgados para personas, cortos para bots. */
export const LIMITS = {
  // Por IP con margen: en datos móviles muchas personas comparten la misma IP (CGNAT).
  checkoutPerIp: { limit: 20, windowMs: HOUR },
  checkoutPerPhone: { limit: 5, windowMs: HOUR },
  subscribePerIp: { limit: 10, windowMs: HOUR },
  subscribePerPhone: { limit: 3, windowMs: DAY },
  phoneLookupPerIp: { limit: 60, windowMs: HOUR },
  phoneLookupPerPhone: { limit: 10, windowMs: HOUR },
  vendorPerIp: { limit: 30, windowMs: 10 * MIN },
  /** Llamadas a Claude por comercio y por día; pasado el tope, el Vendedor responde sin IA. */
  vendorLlmPerTenantDay: { limit: 500, windowMs: DAY },
  registerPerIp: { limit: 10, windowMs: HOUR },
  loginFailsPerIp: { limit: 20, windowMs: 15 * MIN },
  loginFailsPerEmail: { limit: 5, windowMs: 15 * MIN },
} as const;

export const rule = (key: string, l: { limit: number; windowMs: number }): Rule => ({ key, ...l });

/**
 * Consume 1 de cada regla. Si alguna se pasó → respuesta 429 lista para devolver; si no, null.
 */
export async function rateLimited(rules: Rule[], message: string): Promise<NextResponse | null> {
  let retryMs = 0;
  try {
    for (const r of rules) {
      const res = await consumeRateLimit(db(), r.key, r.limit, r.windowMs);
      if (!res.ok) retryMs = Math.max(retryMs, res.retryAfterMs);
    }
  } catch (e) {
    console.error("[abuse] limitador no disponible, dejo pasar:", e instanceof Error ? e.message : e);
    return null;
  }
  if (retryMs === 0) return null;
  return NextResponse.json(
    { error: "rate_limited", message },
    { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(retryMs / 1000))) } },
  );
}

/** Consume 1 y dice si se pasó, sin cortar la ruta (cupos con plan B, p. ej. la IA). */
export async function overQuota(r: Rule): Promise<boolean> {
  try {
    const res = await consumeRateLimit(db(), r.key, r.limit, r.windowMs);
    return !res.ok;
  } catch (e) {
    console.error("[abuse] limitador no disponible:", e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Fuerza bruta de contraseñas: se consulta el bloqueo ANTES de verificar (así durante el
 * bloqueo ni la contraseña correcta entra) y solo se suma cuando la contraseña es incorrecta.
 */
export async function loginBlocked(rules: Rule[]): Promise<NextResponse | null> {
  try {
    const st = await failureStatus(db(), rules.map((r) => r.key));
    const limits = new Map(rules.map((r) => [r.key, r.limit]));
    const hit = st.filter((s) => s.count >= (limits.get(s.key) ?? Infinity));
    if (hit.length === 0) return null;
    const retry = Math.max(...hit.map((h) => h.retryAfterMs));
    return NextResponse.json(
      { error: "Demasiados intentos fallidos. Esperá unos minutos y volvé a probar." },
      { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(retry / 1000))) } },
    );
  } catch (e) {
    console.error("[abuse] limitador no disponible, dejo pasar:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function recordLoginFailure(rules: Rule[]): Promise<void> {
  try {
    // Todas las reglas de login usan la misma ventana.
    await recordFailures(db(), rules.map((r) => r.key), rules[0]?.windowMs ?? 15 * MIN);
  } catch (e) {
    console.error("[abuse] no se pudo registrar el fallo de login:", e instanceof Error ? e.message : e);
  }
}

/** Reglas de login para un comercio, una IP y un email. */
export function loginRules(tenantId: string, ip: string, email: string): Rule[] {
  return [
    rule(`login-fail:ip:${tenantId}:${ip}`, LIMITS.loginFailsPerIp),
    rule(`login-fail:email:${tenantId}:${email.trim().toLowerCase()}`, LIMITS.loginFailsPerEmail),
  ];
}

/**
 * Consultas de invitados por teléfono (reconocer cliente, ver o cambiar suscripciones): límite
 * por IP (frena el barrido de teléfonos) y por teléfono (frena el ataque a una persona).
 */
export async function phoneLookupLimited(req: Request, tenantId: string, phone: string): Promise<NextResponse | null> {
  const digits = normalizePhone(phone);
  return rateLimited(
    [
      rule(`phone-lookup:ip:${tenantId}:${clientIp(req)}`, LIMITS.phoneLookupPerIp),
      ...(digits ? [rule(`phone-lookup:phone:${tenantId}:${digits}`, LIMITS.phoneLookupPerPhone)] : []),
    ],
    "Hiciste muchas consultas seguidas. Esperá un rato y volvé a probar.",
  );
}
