import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { hasAdminRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Estado de la sesión del panel: si hay un admin logueado (para que el panel decida si mostrar
 *  el login o la app). No expone datos sensibles. */
export function GET() {
  const s = readSession();
  const admin = hasAdminRole(s);
  return NextResponse.json({ authed: admin, email: admin ? s!.email : null });
}
