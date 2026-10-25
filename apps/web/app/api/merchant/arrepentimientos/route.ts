import { NextResponse } from "next/server";
import { listWithdrawalRequests } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Panel: solicitudes del botón de arrepentimiento (pendientes primero). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const requests = await db().withTenant(tenant.tenantId, (tx) => listWithdrawalRequests(tx, { limit: 50 }));
  return NextResponse.json({ requests });
}
