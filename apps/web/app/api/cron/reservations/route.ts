import { NextResponse } from "next/server";
import { releaseExpiredReservations } from "@commerce/modules/inventory";
import { db } from "@/lib/db";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Libera reservas de stock vencidas y repone el inventario (tarea cross-tenant vía la
 * función SQL SECURITY DEFINER). La dispara Vercel Cron. Gated por CRON_SECRET.
 */
export async function GET() {
  if (!requireServiceToken("CRON_SECRET")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const released = await releaseExpiredReservations(db());
  return NextResponse.json({ released });
}
