import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db().query("select 1");
    return NextResponse.json({ ok: true, db: "up", ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "down", error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
