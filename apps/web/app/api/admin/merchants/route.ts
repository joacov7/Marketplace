import { NextResponse } from "next/server";
import { createMerchant, listMerchants } from "@commerce/platform";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Comercios del tenant. Gated por token de servicio (tenant admin; demo). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const merchants = await db().withTenant(tenant.tenantId, (tx) => listMerchants(tx));
  return NextResponse.json({ merchants });
}

/** Alta de un comercio dentro del tenant. */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { slug?: string; name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  const slug = (body.slug || body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const res = await createMerchant(db(), { tenantId: tenant.tenantId, slug, name: body.name });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ merchantId: res.value.merchantId, slug }, { status: 201 });
}
