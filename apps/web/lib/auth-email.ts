import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export type EmailTokenPurpose = "owner_invitation" | "staff_invitation" | "password_reset";

export interface EmailTokenInput {
  tenantId: string;
  email: string;
  purpose: EmailTokenPurpose;
  role?: string;
  scopeType?: string;
  scopeId?: string;
  expiresInMinutes: number;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createEmailToken(input: EmailTokenInput): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db().query(
    `insert into auth_email_tokens
      (token_hash, purpose, tenant_id, email, role, scope_type, scope_id, expires_at)
     values ($1,$2,$3,lower($4),$5,$6,$7,now() + ($8 * interval '1 minute'))`,
    [tokenHash(token), input.purpose, input.tenantId, input.email.trim(), input.role ?? null,
      input.scopeType ?? null, input.scopeId ?? null, input.expiresInMinutes],
  );
  return token;
}

/** Consume atómicamente un token válido. Una segunda solicitud no puede reutilizarlo. */
export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
  if (!token || token.length > 200) return null;
  const rows = await db().query<{
    tenant_id: string; email: string; role: string | null; scope_type: string | null; scope_id: string | null;
  }>(
    `update auth_email_tokens
        set consumed_at = now()
      where token_hash = $1 and purpose = $2 and consumed_at is null and expires_at > now()
      returning tenant_id, email, role, scope_type, scope_id`,
    [tokenHash(token), purpose],
  );
  return rows[0] ?? null;
}

export async function sendAuthEmail(input: { to: string; subject: string; text: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Faltan RESEND_API_KEY o AUTH_EMAIL_FROM");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`No se pudo enviar el email (Resend ${response.status})`);
}

export function appBaseUrl(): string {
  const value = process.env.APP_BASE_URL;
  if (!value) throw new Error("Falta APP_BASE_URL");
  const url = new URL(value);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("APP_BASE_URL debe usar HTTPS");
  return url.origin;
}
