import { cookies } from "next/headers";
import { signSession, verifySession, SESSION_TTL_MS, type SessionPayload, type AuthUser } from "@commerce/platform";

const COOKIE = "session";

/** Secreto independiente para firmar cookies de sesión. */
function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET debe estar configurado y tener al menos 32 caracteres");
  return "local-development-session-secret-not-for-production";
}

export function buildSessionToken(user: AuthUser, tenantId: string): string {
  const payload: SessionPayload = {
    userId: user.id,
    tenantId,
    email: user.email,
    roles: user.roles,
    exp: Date.now() + SESSION_TTL_MS,
  };
  return signSession(payload, secret());
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/** Lee y verifica la sesión de la cookie. null si no hay o es inválida/expirada. */
export function readSession(): SessionPayload | null {
  const s = secret();
  if (!s) return null;
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  return verifySession(raw, s);
}

export const SESSION_COOKIE = COOKIE;
