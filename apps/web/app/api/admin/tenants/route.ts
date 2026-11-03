import { NextResponse } from "next/server";
import { createTenant, PET_SHOP_TEMPLATE } from "@commerce/platform";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";
import { createEmailToken, sendAuthEmail, appBaseUrl } from "@/lib/auth-email";

export const dynamic = "force-dynamic";

interface Body {
  slug: string;
  name: string;
  ownerEmail: string;
  region: { slug: string; name: string };
  configOverrides?: Array<{ key: string; value: unknown; reason?: string }>;
}

/**
 * Provisioning de un tenant (White Label) por plantilla — sin código por cliente. Gated
 * por token de servicio (super admin de plataforma).
 */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.slug || !body.name || !body.region?.slug || !body.ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.ownerEmail.trim())) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const res = await createTenant(db(), {
    slug: body.slug,
    name: body.name,
    template: PET_SHOP_TEMPLATE,
    region: body.region,
    actor: "super-admin",
    ...(body.configOverrides ? { configOverrides: body.configOverrides } : {}),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

  const ownerEmail = body.ownerEmail.trim().toLowerCase();
  try {
    const token = await createEmailToken({ tenantId: res.value.tenantId, email: ownerEmail, purpose: "owner_invitation", role: "owner", scopeType: "tenant", scopeId: res.value.tenantId, expiresInMinutes: 72 * 60 });
    const link = new URL("/merchant", appBaseUrl());
    link.searchParams.set("tenant", body.slug);
    link.searchParams.set("mode", "invite");
    link.searchParams.set("token", token);
    await sendAuthEmail({ to: ownerEmail, subject: "Activá el panel de " + body.name,
      text: "Fuiste invitado como propietario de " + body.name + ". Creá tu contraseña: " + link.toString() + "\nEl enlace vence en 72 horas y solo puede usarse una vez.",
      html: "<p>Fuiste invitado como propietario de <b>" + body.name + "</b>.</p><p><a href=\"" + link.toString() + "\">Activar mi cuenta</a></p><p>El enlace vence en 72 horas y solo puede usarse una vez.</p>" });
  } catch (error) {
    console.error("[auth-email] initial owner invitation failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...res.value, ownerInvitationSent: false, error: "El comercio fue creado, pero no se pudo enviar la invitación. Reintentá desde la operación de invitación del propietario." }, { status: 502 });
  }
  return NextResponse.json({ ...res.value, ownerInvitationSent: true }, { status: 201 });
}
