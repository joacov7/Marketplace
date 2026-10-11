import { NextResponse } from "next/server";
import { changePassword, PANEL_PASSWORD_MIN } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";
import { hasAdminRole } from "@/lib/auth";
import { loginBlocked, loginRules, recordLoginFailure } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Cambiar MI contraseña del panel: hay que estar logueado con usuario (no con el código
 * maestro) y escribir la contraseña actual. Una contraseña actual incorrecta cuenta como
 * intento fallido de login (mismo bloqueo), así una sesión abierta no sirve para adivinarla.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const session = readSession();
  if (!session || !hasAdminRole(session) || session.tenantId !== tenant.tenantId) {
    return NextResponse.json({ error: "Para cambiar tu contraseña entrá con tu usuario y contraseña." }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json({ error: "Completá la contraseña actual y la nueva." }, { status: 400 });
  }

  const rules = loginRules(tenant.tenantId, clientIp(req), session.email);
  const blocked = await loginBlocked(rules);
  if (blocked) return blocked;

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    changePassword(tx, { userId: session.userId, currentPassword: body.currentPassword!, newPassword: body.newPassword! }),
  );
  if (!res.ok) {
    if (res.error === "wrong_password") {
      await recordLoginFailure(rules);
      return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
    }
    if (res.error === "too_short") {
      return NextResponse.json({ error: `La contraseña nueva tiene que tener al menos ${PANEL_PASSWORD_MIN} caracteres.` }, { status: 400 });
    }
    return NextResponse.json({ error: "No encontramos tu usuario." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
