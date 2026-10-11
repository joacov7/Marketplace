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

/** Contraseña mínima de las cuentas del panel. */
export const PANEL_PASSWORD_MIN = 8;

/**
 * Cambia la contraseña de un usuario verificando la ACTUAL (lo hace la propia persona desde
 * el panel). Corre con contexto de tenant (RLS). Guarda solo el hash.
 */
export async function changePassword(
  db: Db,
  input: { userId: string; currentPassword: string; newPassword: string },
): Promise<Result<true, "wrong_password" | "too_short" | "not_found">> {
  if (input.newPassword.length < PANEL_PASSWORD_MIN) return err("too_short");
  const [row] = await db.query<{ password_hash: string }>(`select password_hash from users where id = $1`, [input.userId]);
  if (!row) return err("not_found");
  if (!verifyPassword(input.currentPassword, row.password_hash)) return err("wrong_password");
  await db.query(`update users set password_hash = $2 where id = $1`, [input.userId, hashPassword(input.newPassword)]);
  return ok(true);
}

/**
 * Restablece la contraseña de un usuario del PANEL por email, sin pedir la anterior. Solo lo
 * puede hacer quien tiene el código maestro o una sesión de admin del mismo comercio (el gate
 * está en la ruta). No toca cuentas de clientes de la tienda: el usuario tiene que tener un rol
 * de administración. Corre con contexto de tenant (RLS).
 */
export async function resetPanelPassword(
  db: Db,
  input: { email: string; newPassword: string; adminRoles: readonly string[] },
): Promise<Result<{ userId: string }, "not_found" | "not_panel_user" | "too_short">> {
  if (input.newPassword.length < PANEL_PASSWORD_MIN) return err("too_short");
  const [u] = await db.query<{ id: string }>(`select id from users where email = lower($1)`, [input.email.trim()]);
  if (!u) return err("not_found");
  const roles = await loadRoles(db, u.id);
  if (!roles.some((r) => input.adminRoles.includes(r.role))) return err("not_panel_user");
  await db.query(`update users set password_hash = $2 where id = $1`, [u.id, hashPassword(input.newPassword)]);
  return ok({ userId: u.id });
}
