import { NextResponse } from "next/server";
import { listSubscriptionsAdmin } from "@commerce/modules/subscriptions";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Lista todas las suscripciones del comercio (vista admin del panel). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listSubscriptionsAdmin(tx));
  return NextResponse.json({ subscriptions: rows });
}
