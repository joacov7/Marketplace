import { NextResponse } from "next/server";
import { resetPanelPassword, clearFailures, PANEL_PASSWORD_MIN } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireAdminForTenant, PANEL_ROLES } from "@/lib/auth";
import { loginRules } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * RECUPERAR la contraseña de un usuario del panel (olvido): sin la anterior, con el código
 * maestro — o, ya adentro, una sesión de admin de ESTE comercio (p. ej. el dueño le resetea la
 * clave a un empleado). Solo cuentas del panel, nunca de clientes de la tienda. Destraba el
 * bloqueo por intentos fallidos de ese email para que pueda entrar enseguida.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  if (!requireAdminForTenant(tenant.tenantId)) {
    return NextResponse.json({ error: "El código de acceso no es correcto." }, { status: 401 });
  }

  let body: { email?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !body.newPassword) return NextResponse.json({ error: "Completá el email y la contraseña nueva." }, { status: 400 });

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    resetPanelPassword(tx, { email, newPassword: body.newPassword!, adminRoles: PANEL_ROLES }),
  );
  if (!res.ok) {
    const msg =
      res.error === "too_short" ? `La contraseña nueva tiene que tener al menos ${PANEL_PASSWORD_MIN} caracteres.`
      : res.error === "not_panel_user" ? "Ese email es de una cuenta de cliente de la tienda, no del panel."
      : "No hay un usuario del panel con ese email.";
    return NextResponse.json({ error: msg }, { status: res.error === "too_short" ? 400 : 404 });
  }

  // Destrabar el email (el bloqueo por IP no se toca: es de quien hizo los intentos).
  const emailKey = loginRules(tenant.tenantId, clientIp(req), email).find((r) => r.key.startsWith("login-fail:email:"));
  if (emailKey) await clearFailures(db(), [emailKey.key]).catch(() => {});

  return NextResponse.json({ ok: true });
}
