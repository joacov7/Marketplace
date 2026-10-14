import { NextResponse } from "next/server";
import { createUser } from "@commerce/platform";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Crea un usuario administrador del panel. Protegido por `panelTenant` (código maestro o
 * sesión de admin de ESTE comercio):
 * el PRIMER admin se crea con el código de acceso maestro (todavía no hay sesión); después, un
 * admin logueado puede sumar más usuarios. Rol "owner" a nivel tenant.
 */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password || body.password.length < 8) {
    return NextResponse.json({ error: "Poné un email y una contraseña de al menos 8 caracteres." }, { status: 400 });
  }

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    createUser(tx, { tenantId: tenant.tenantId, email, password: body.password!, role: "owner", scopeType: "tenant", scopeId: tenant.tenantId }),
  );
  if (!res.ok) {
    return NextResponse.json({ error: res.error === "email_taken" ? "Ese email ya tiene un usuario." : res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
