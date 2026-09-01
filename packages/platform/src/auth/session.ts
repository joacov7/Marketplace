import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sesión sin estado firmada con HMAC-SHA256 (sin dependencias, sin tabla de sesiones).
 * Token = base64url(payload) + "." + base64url(HMAC(payload, secret)). El payload lleva
 * el userId, el tenantId, los roles y una expiración. Se guarda en una cookie httpOnly.
 * El aislamiento sigue dependiendo de que cada query corra con withTenant(tenantId).
 */
export interface SessionPayload {
  userId: string;
  tenantId: string;
  email: string;
  roles: Array<{ role: string; scopeType: string; scopeId: string }>;
  exp: number; // epoch ms
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** TTL por defecto de una sesión: 30 días. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
