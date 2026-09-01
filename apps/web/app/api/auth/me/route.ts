import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = readSession();
  if (!s) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { email: s.email, roles: s.roles } });
}
