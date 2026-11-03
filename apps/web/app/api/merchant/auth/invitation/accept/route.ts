import { NextResponse } from "next/server";
import { createUser } from "@commerce/platform";
import { db } from "@/lib/db";
import { consumeEmailToken } from "@/lib/auth-email";
import { buildSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import { rateLimited, rule } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await rateLimited([rule(`invitation-accept:ip:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60_000 })], "Demasiados intentos. Esperá un rato y volvé a intentar.");
  if (limited) return limited;
  let body: { token?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.token || !body.password || body.password.length < 8) {
    return NextResponse.json({ error: "El enlace o la contraseña no son válidos." }, { status: 400 });
  }

  // El canje, el alta y la lectura de roles ocurren en una única transacción.
  // Cualquier error lanza una excepción y revierte también el consumo del token.
  let outcome: { grant: { tenant_id: string }; user: { id: string; email: string; roles: { role: string; scopeType: string; scopeId: string }[] } };
  try {
    outcome = await db().tx(async (tx) => {
      const grant = await consumeEmailToken(tx, body.token!, "owner_invitation")
        ?? await consumeEmailToken(tx, body.token!, "staff_invitation");
      if (!grant || !grant.role || !grant.scope_type || !grant.scope_id) throw new Error("invalid_invitation");
      if (grant.role !== "owner" && grant.role !== "admin" && grant.role !== "merchant_admin") throw new Error("invalid_role");
      await tx.query("select set_config('app.tenant_id', $1, true)", [grant.tenant_id]);
      const created = await createUser(tx, {
        tenantId: grant.tenant_id, email: grant.email, password: body.password!,
        role: grant.role, scopeType: grant.scope_type, scopeId: grant.scope_id,
      });
      if (!created.ok) throw new Error(created.error === "email_taken" ? "email_taken" : "create_failed");
      const rows = await tx.query<{ id: string; email: string }>("select id, email from users where id = $1", [created.value.userId]);
      const roles = await tx.query<{ role: string; scope_type: string; scope_id: string }>("select role, scope_type, scope_id from user_roles where user_id = $1", [created.value.userId]);
      if (!rows[0]) throw new Error("create_failed");
      return {
        grant,
        user: { id: rows[0].id, email: rows[0].email, roles: roles.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id })) },
      };
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "email_taken" ? "Ese email ya tiene una cuenta." : "La invitación venció o no se pudo activar. Solicitá una nueva.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { grant, user } = outcome;

    const response = NextResponse.json({ ok: true, email: user.email });
  response.cookies.set(SESSION_COOKIE, buildSessionToken(user, grant.tenant_id), sessionCookieOptions);
  return response;
}
