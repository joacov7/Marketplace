import { NextResponse } from "next/server";
import { drainOutbox } from "@commerce/platform";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Drena el outbox (patrón A2: sin worker residente, lo dispara Vercel Cron). Publica los
 * eventos pendientes; por ahora el consumidor loguea (notificaciones/analytics se cablean
 * en un paso siguiente). Gated por CRON_SECRET.
 */
export async function GET() {
  if (!requireServiceToken("CRON_SECRET")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const published = await drainOutbox(db(), async (evt) => {
    console.log(`[outbox] ${evt.type} tenant=${evt.tenantId} id=${evt.id}`);
  });
  return NextResponse.json({ published });
}
