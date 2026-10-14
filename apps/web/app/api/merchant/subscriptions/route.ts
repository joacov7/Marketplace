import { NextResponse } from "next/server";
import { listSubscriptionsAdmin } from "@commerce/modules/subscriptions";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Lista todas las suscripciones del comercio (vista admin del panel). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  const rows = await db().withTenant(tenant.tenantId, (tx) => listSubscriptionsAdmin(tx));
  return NextResponse.json({ subscriptions: rows });
}
