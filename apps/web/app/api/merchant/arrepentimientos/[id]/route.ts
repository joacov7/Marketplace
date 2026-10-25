import { NextResponse } from "next/server";
import { resolveWithdrawalRequest } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Panel: marca una solicitud de arrepentimiento como resuelta. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const res = await db().withTenant(tenant.tenantId, (tx) => resolveWithdrawalRequest(tx, params.id));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
