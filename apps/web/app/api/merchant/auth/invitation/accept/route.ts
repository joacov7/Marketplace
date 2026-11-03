import { NextResponse } from "next/server";
import { createUser } from "@commerce/platform";
import { db } from "@/lib/db";
import { consumeEmailToken } from "@/lib/auth-email";
import { buildSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.token || !body.password || body.password.length < 8) {
    return NextResponse.json({ error: "El enlace o la contraseña no son válidos." }, { status: 400 });
  }

  // Acepta exclusivamente invitaciones; los tokens de reset no sirven para crear usuarios.
  const grant = await consumeEmailToken(body.token, "owner_invitation")
    ?? await consumeEmailToken(body.token, "staff_invitation");
  if (!grant || !grant.role || !grant.scope_type || !grant.scope_id) {
    return NextResponse.json({ error: "La invitación venció o ya fue utilizada." }, { status: 400 });
  }
  if (grant.role !== "owner" && grant.role !== "admin" && grant.role !== "merchant_admin") {
    return NextResponse.json({ error: "Rol de invitación no permitido." }, { status: 400 });
  }

  const created = await db().withTenant(grant.tenant_id, (tx) => createUser(tx, {
    tenantId: grant.tenant_id, email: grant.email, password: body.password!,
    role: grant.role!, scopeType: grant.scope_type!, scopeId: grant.scope_id!,
  }));
  if (!created.ok) return NextResponse.json({ error: created.error === "email_taken" ? "Ese email ya tiene una cuenta." : "No se pudo activar la invitación." }, { status: 400 });

  const user = await db().withTenant(grant.tenant_id, async (tx) => {
    const rows = await tx.query<{ id: string; email: string }>("select id, email from users where id = $1", [created.value.userId]);
    const roles = await tx.query<{ role: string; scope_type: string; scope_id: string }>("select role, scope_type, scope_id from user_roles where user_id = $1", [created.value.userId]);
    return rows[0] ? { id: rows[0].id, email: rows[0].email, roles: roles.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id })) } : null;
  });
  if (!user) return NextResponse.json({ error: "No se pudo iniciar la sesión." }, { status: 500 });

  const response = NextResponse.json({ ok: true, email: user.email });
  response.cookies.set(SESSION_COOKIE, buildSessionToken(user, grant.tenant_id), sessionCookieOptions);
  return response;
}
