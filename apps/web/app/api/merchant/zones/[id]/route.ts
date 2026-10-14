import { NextResponse } from "next/server";
import { updateZone, deleteZone } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Edita una zona (nombre / costo / ETA). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { name?: string; customerChargeMinor?: string | number; etaMinutes?: number | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  await db().withTenant(tenant.tenantId, (tx) =>
    updateZone(tx, {
      id: params.id,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.customerChargeMinor !== undefined ? { customerChargeMinor: BigInt(Math.max(0, Math.round(Number(body.customerChargeMinor)))) } : {}),
      ...(body.etaMinutes !== undefined ? { etaMinutes: body.etaMinutes === null ? null : Number(body.etaMinutes) } : {}),
    }),
  );
  return NextResponse.json({ ok: true });
}

/** Elimina una zona (y su tarifa). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  await db().withTenant(tenant.tenantId, (tx) => deleteZone(tx, params.id));
  return NextResponse.json({ ok: true });
}
