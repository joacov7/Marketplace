import { NextResponse } from "next/server";
import { updateSubscription, type SubscriptionStatus } from "@commerce/modules/subscriptions";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

const STATUS = new Set(["active", "paused", "cancelled"]);

/** El comercio pausa / reanuda / cancela o ajusta una suscripción desde el panel. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { status?: string; intervalDays?: number; qty?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.status && !STATUS.has(body.status)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

  try {
    const found = await db().withTenant(tenant.tenantId, (tx) =>
      updateSubscription(tx, params.id, {
        ...(body.status ? { status: body.status as SubscriptionStatus } : {}),
        ...(body.intervalDays !== undefined ? { intervalDays: Math.round(Number(body.intervalDays)) } : {}),
        ...(body.qty !== undefined ? { qty: Math.round(Number(body.qty)) } : {}),
      }),
    );
    if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
