import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";
import { createEmailToken, sendAuthEmail, appBaseUrl } from "@/lib/auth-email";
import { rateLimited, rule } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Solo el propietario autenticado puede invitar administradores del mismo tenant. */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const session = readSession();
  const isOwner = session?.tenantId === tenant.tenantId && session.roles.some(
    (role) => role.role === "owner" && role.scopeType === "tenant" && role.scopeId === tenant.tenantId,
  );
  if (!isOwner) return NextResponse.json({ error: "Solo el propietario puede invitar usuarios." }, { status: 403 });

  const limited = await rateLimited([rule(`staff-invitation:ip:${tenant.tenantId}:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60_000 })], "Demasiadas invitaciones. Esperá un rato.");
  if (limited) return limited;

  let body: { email?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase() ?? "";
  const role = body.role ?? "admin";
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !["admin", "merchant_admin"].includes(role)) {
    return NextResponse.json({ error: "Email o rol inválido." }, { status: 400 });
  }

  const existing = await db().withTenant(tenant.tenantId, (tx) => tx.query<{ id: string }>(
    "select u.id from users u join user_roles r on r.user_id = u.id where u.email = lower($1) and r.role in ('owner','admin','merchant_admin') limit 1",
    [email],
  ));
  if (existing.length) return NextResponse.json({ error: "Ese email ya tiene acceso al panel." }, { status: 409 });

  try {
    const token = await createEmailToken({
      tenantId: tenant.tenantId, email, purpose: "staff_invitation", role,
      scopeType: "tenant", scopeId: tenant.tenantId, expiresInMinutes: 72 * 60,
    });
    const link = new URL("/merchant", appBaseUrl());
    link.searchParams.set("tenant", tenant.slug);
    link.searchParams.set("mode", "invite");
    link.searchParams.set("token", token);
    await sendAuthEmail({
      to: email, subject: `Invitación al panel de ${tenant.name}`,
      text: `Fuiste invitado al panel de ${tenant.name}. Activá tu cuenta: ${link.toString()}\nEl enlace vence en 72 horas.`,
      html: `<p>Fuiste invitado al panel de <b>${tenant.name}</b>.</p><p><a href="${link.toString()}">Activar mi cuenta</a></p><p>El enlace vence en 72 horas.</p>`,
    });
  } catch (error) {
    console.error("[auth-email] staff invitation delivery failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo enviar la invitación. Revisá la configuración de email." }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
