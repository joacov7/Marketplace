import { NextResponse } from "next/server";
import { createUser, verifyCredentials } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { buildSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Registro de cliente para el tenant. Crea el usuario (rol customer) e inicia sesión. */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.email || !body.password || body.password.length < 6) {
    return NextResponse.json({ error: "email y password (min 6) requeridos" }, { status: 400 });
  }

  const created = await db().withTenant(tenant.tenantId, (tx) =>
    createUser(tx, {
      tenantId: tenant.tenantId,
      email: body.email!,
      password: body.password!,
      role: "customer",
      scopeType: "tenant",
      scopeId: tenant.tenantId,
    }),
  );
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 409 });

  const user = await db().withTenant(tenant.tenantId, (tx) => verifyCredentials(tx, body.email!, body.password!));
  if (!user) return NextResponse.json({ error: "post_register_login_failed" }, { status: 500 });

  const res = NextResponse.json({ email: user.email, roles: user.roles }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, buildSessionToken(user, tenant.tenantId), sessionCookieOptions);
  return res;
}
