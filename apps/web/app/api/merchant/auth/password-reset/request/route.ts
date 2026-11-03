import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { createEmailToken, sendAuthEmail, appBaseUrl } from "@/lib/auth-email";
import { rateLimited, rule } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const limited = await rateLimited([rule(`password-reset-request:ip:${tenant.tenantId}:${clientIp(req)}`, { limit: 8, windowMs: 60 * 60_000 })], "Demasiadas solicitudes. Esperá un rato y volvé a intentar.");
  if (limited) return limited;
  let body: { email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Si el email pertenece a una cuenta del panel, recibirás un enlace." });
  }

  // Respuesta indistinguible para evitar enumerar usuarios.
  const rows = await db().withTenant(tenant.tenantId, async (tx) => tx.query<{ id: string }>(
    `select u.id from users u join user_roles r on r.user_id = u.id
      where u.email = lower($1) and r.role in ('owner','admin','merchant_admin') limit 1`, [email],
  ));
  if (rows.length) {
    try {
    const token = await createEmailToken({ tenantId: tenant.tenantId, email, purpose: "password_reset", expiresInMinutes: 30 });
    const link = new URL("/merchant", appBaseUrl());
    link.searchParams.set("tenant", tenant.slug);
    link.searchParams.set("mode", "reset");
    link.searchParams.set("token", token);
    await sendAuthEmail({
      to: email, subject: `Recuperar acceso a ${tenant.name}`,
      text: `Para cambiar tu contraseña ingresá a: ${link.toString()}\nEl enlace vence en 30 minutos y solo puede usarse una vez.`,
      html: `<p>Recibimos un pedido para cambiar la contraseña del panel de ${tenant.name}.</p><p><a href="${link.toString()}">Crear una contraseña nueva</a></p><p>El enlace vence en 30 minutos y solo puede usarse una vez.</p>`,
    });
    } catch (error) {
      console.error("[auth-email] password reset delivery failed:", error instanceof Error ? error.message : "unknown");
    }
  }
  return NextResponse.json({ ok: true, message: "Si el email pertenece a una cuenta del panel, recibirás un enlace." });
}
