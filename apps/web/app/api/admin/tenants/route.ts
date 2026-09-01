import { NextResponse } from "next/server";
import { createTenant, PET_SHOP_TEMPLATE } from "@commerce/platform";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Body {
  slug: string;
  name: string;
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
  if (!body.slug || !body.name || !body.region?.slug) {
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

  return NextResponse.json(res.value, { status: 201 });
}
