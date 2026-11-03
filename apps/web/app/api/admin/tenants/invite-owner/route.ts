import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";
import { createEmailToken, sendAuthEmail, appBaseUrl } from "@/lib/auth-email";

export const dynamic = "force-dynamic";

/** Reenvío de la invitación inicial cuando falló el proveedor de correo al provisionar. */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { tenantSlug?: string; ownerEmail?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const tenantSlug = body.tenantSlug?.trim() ?? "";
  const email = body.ownerEmail?.trim().toLowerCase() ?? "";
  if (!tenantSlug || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    return NextResponse.json({ error: "tenantSlug y ownerEmail válidos son obligatorios." }, { status: 400 });
  }
  const rows = await db().query<{ id: string; name: string; slug: string }>(
    "select id, name, slug from tenants where slug = $1 limit 1", [tenantSlug],
  );
  const tenant = rows[0];
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  try {
    const token = await createEmailToken({
      tenantId: tenant.id, email, purpose: "owner_invitation", role: "owner",
      scopeType: "tenant", scopeId: tenant.id, expiresInMinutes: 72 * 60,
    });
    const link = new URL("/merchant", appBaseUrl());
    link.searchParams.set("tenant", tenant.slug);
    link.searchParams.set("mode", "invite");
    link.searchParams.set("token", token);
    await sendAuthEmail({
      to: email, subject: "Activá el panel de " + tenant.name,
      text: "Fuiste invitado como propietario de " + tenant.name + ". Creá tu contraseña: " + link.toString() + "\nEl enlace vence en 72 horas.",
      html: "<p>Fuiste invitado como propietario de <b>" + tenant.name + "</b>.</p><p><a href=\"" + link.toString() + "\">Activar mi cuenta</a></p><p>El enlace vence en 72 horas.</p>",
    });
  } catch (error) {
    console.error("[auth-email] owner invitation resend failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "No se pudo enviar la invitación. Revisá la configuración de email." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
