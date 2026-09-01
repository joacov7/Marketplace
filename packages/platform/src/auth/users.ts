import { type Result, ok, err } from "@commerce/contracts";
import type { Db } from "../db/port.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface UserRole {
  role: string;
  scopeType: string;
  scopeId: string;
}
export interface AuthUser {
  id: string;
  email: string;
  roles: UserRole[];
}

/**
 * Crea un usuario y le asigna un rol dentro de un scope. Corre con contexto de tenant
 * (RLS). Email único por tenant. Guarda solo el hash de la contraseña.
 */
export async function createUser(
  db: Db,
  input: { tenantId: string; email: string; password: string; role: string; scopeType: string; scopeId: string },
): Promise<Result<{ userId: string }, string>> {
  try {
    const [u] = await db.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash) values ($1, lower($2), $3) returning id`,
      [input.tenantId, input.email, hashPassword(input.password)],
    );
    const userId = u!.id;
    await db.query(
      `insert into user_roles (tenant_id, user_id, role, scope_type, scope_id) values ($1,$2,$3,$4,$5)`,
      [input.tenantId, userId, input.role, input.scopeType, input.scopeId],
    );
    return ok({ userId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(/unique|duplicate/i.test(msg) ? "email_taken" : msg);
  }
}

async function loadRoles(db: Db, userId: string): Promise<UserRole[]> {
  const rows = await db.query<{ role: string; scope_type: string; scope_id: string }>(
    `select role, scope_type, scope_id from user_roles where user_id = $1`,
    [userId],
  );
  return rows.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id }));
}

/** Verifica email + contraseña; devuelve el usuario con sus roles, o null si no matchea. */
export async function verifyCredentials(
  db: Db,
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const [row] = await db.query<{ id: string; email: string; password_hash: string }>(
    `select id, email, password_hash from users where email = lower($1)`,
    [email],
  );
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, roles: await loadRoles(db, row.id) };
}

export async function getUser(db: Db, userId: string): Promise<AuthUser | null> {
  const [row] = await db.query<{ id: string; email: string }>(`select id, email from users where id = $1`, [userId]);
  if (!row) return null;
  return { id: row.id, email: row.email, roles: await loadRoles(db, row.id) };
}
