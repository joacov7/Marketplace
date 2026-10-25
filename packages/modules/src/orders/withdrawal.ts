import { randomInt } from "node:crypto";
import { type Db, enqueueEvent } from "@commerce/platform";
import { type Result, ok, err } from "@commerce/contracts";

/**
 * Botón de arrepentimiento: el cliente pide revocar una compra (sin registrarse) y recibe en el
 * momento un código de identificación de la solicitud. El comercio la ve y la marca resuelta
 * desde el panel. Corre con contexto de tenant (RLS).
 */

export interface WithdrawalRequest {
  id: string;
  code: string;
  name: string;
  contact: string;
  orderRef: string | null;
  message: string | null;
  status: "pendiente" | "resuelta";
  createdAt: string;
  resolvedAt: string | null;
}

// Sin caracteres que se confunden al dictarlos (0/O, 1/I/L).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `ARR-${s}`;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export async function createWithdrawalRequest(
  db: Db,
  input: { tenantId: string; name: unknown; contact: unknown; orderRef?: unknown; message?: unknown },
): Promise<Result<{ id: string; code: string; createdAt: string }, string>> {
  const name = clean(input.name, 120);
  const contact = clean(input.contact, 120);
  const orderRef = clean(input.orderRef, 80) || null;
  const message = (typeof input.message === "string" ? input.message.trim().slice(0, 1000) : "") || null;
  if (name.length < 2) return err("invalid_name");
  if (contact.replace(/\D+/g, "").length < 6 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return err("invalid_contact");

  // El código es único por comercio; con 31^6 combinaciones un choque es rarísimo, pero se reintenta.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const rows = await db.query<{ id: string; created_at: string }>(
      `insert into withdrawal_requests (tenant_id, code, name, contact, order_ref, message)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id, code) do nothing
       returning id, created_at`,
      [input.tenantId, code, name, contact, orderRef, message],
    );
    const r = rows[0];
    if (!r) continue;
    await enqueueEvent(db, { tenantId: input.tenantId, type: "withdrawal.requested", payload: { id: r.id, code } });
    return ok({ id: r.id, code, createdAt: new Date(r.created_at).toISOString() });
  }
  return err("code_generation_failed");
}

export async function listWithdrawalRequests(db: Db, opts: { limit?: number } = {}): Promise<WithdrawalRequest[]> {
  const rows = await db.query<{
    id: string; code: string; name: string; contact: string; order_ref: string | null; message: string | null;
    status: "pendiente" | "resuelta"; created_at: string; resolved_at: string | null;
  }>(
    `select id, code, name, contact, order_ref, message, status, created_at, resolved_at
       from withdrawal_requests
      order by (status = 'pendiente') desc, created_at desc
      limit $1`,
    [Math.min(Math.max(1, opts.limit ?? 50), 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    contact: r.contact,
    orderRef: r.order_ref,
    message: r.message,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  }));
}

export async function resolveWithdrawalRequest(db: Db, id: string): Promise<Result<true, string>> {
  const rows = await db.query<{ id: string }>(
    `update withdrawal_requests set status = 'resuelta', resolved_at = coalesce(resolved_at, now())
      where id = $1 returning id`,
    [id],
  );
  return rows.length ? ok(true) : err("not_found");
}
