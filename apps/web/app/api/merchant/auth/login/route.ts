import { NextResponse } from "next/server";
import { verifyCredentials } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { buildSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";
import { hasAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Login del PANEL: valida email + contraseña y exige un rol de administración. Setea la sesión
 *  en una cookie httpOnly (reemplaza al "código de acceso" único guardado en el navegador). */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.email || !body.password) return NextResponse.json({ error: "missing_credentials" }, { status: 400 });

  const user = await db().withTenant(tenant.tenantId, (tx) => verifyCredentials(tx, body.email!, body.password!));
  if (!user) return NextResponse.json({ error: "Email o contraseña incorrectos." }, { status: 401 });

  const session = { userId: user.id, tenantId: tenant.tenantId, email: user.email, roles: user.roles, exp: 0 };
  if (!hasAdminRole(session)) return NextResponse.json({ error: "Tu usuario no tiene acceso al panel." }, { status: 403 });

  const res = NextResponse.json({ ok: true, email: user.email });
  res.cookies.set(SESSION_COOKIE, buildSessionToken(user, tenant.tenantId), sessionCookieOptions);
  return res;
}
