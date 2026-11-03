import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Los flujos con código maestro fueron retirados. Usar invitaciones y recuperación por email. */
export async function POST() {
  return NextResponse.json(
    { error: "Este método de acceso fue retirado. Usá la invitación o recuperación por email." },
    { status: 410 },
  );
}
