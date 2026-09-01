import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db().query("select 1");
    return NextResponse.json({
      ok: true,
      db: "up",
      urlVar: process.env.DATABASE_URL ? "DATABASE_URL" : process.env.POSTGRES_URL ? "POSTGRES_URL" : "none",
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        db: "down",
        error: e instanceof Error ? e.message : String(e),
        seesEnv: {
          DATABASE_URL: Boolean(process.env.DATABASE_URL),
          POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
        },
      },
      { status: 503 },
    );
  }
}
