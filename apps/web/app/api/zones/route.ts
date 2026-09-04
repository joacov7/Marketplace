import { NextResponse } from "next/server";
import { listZones } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Zonas de reparto públicas para el checkout (nombre + costo + ETA). Sin datos sensibles. */
export async function GET(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
  const zones = await db().withTenant(tenant.tenantId, (tx) => listZones(tx));
  return NextResponse.json({
    zones: zones.map((z) => ({ name: z.name, customerChargeMinor: z.customerChargeMinor.toString(), etaMinutes: z.etaMinutes })),
  });
}
