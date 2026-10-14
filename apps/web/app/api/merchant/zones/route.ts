import { NextResponse } from "next/server";
import { listZones, createZone } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Lista las zonas de reparto del comercio (nombre + costo al cliente + ETA). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const zones = await db().withTenant(tenant.tenantId, (tx) => listZones(tx));
  return NextResponse.json({
    zones: zones.map((z) => ({ id: z.id, name: z.name, customerChargeMinor: z.customerChargeMinor.toString(), etaMinutes: z.etaMinutes })),
  });
}

/** Crea una zona con su tarifa. */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { name?: string; customerChargeMinor?: string | number; etaMinutes?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "missing_name" }, { status: 400 });
  const charge = BigInt(Math.max(0, Math.round(Number(body.customerChargeMinor ?? 0))));
  const eta = Number(body.etaMinutes);

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    createZone(tx, {
      tenantId: tenant.tenantId,
      name: body.name!.trim(),
      customerChargeMinor: charge,
      ...(Number.isFinite(eta) && eta > 0 ? { etaMinutes: eta } : {}),
    }),
  );
  return NextResponse.json(res, { status: 201 });
}
