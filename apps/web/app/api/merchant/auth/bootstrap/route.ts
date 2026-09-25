import { NextResponse } from "next/server";
import { createUser } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Crea un usuario administrador del panel. Protegido por `requireServiceToken("ADMIN_API_TOKEN")`:
 * el PRIMER admin se crea con el código de acceso maestro (todavía no hay sesión); después, un
 * admin logueado puede sumar más usuarios. Rol "owner" a nivel tenant.
 */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

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
