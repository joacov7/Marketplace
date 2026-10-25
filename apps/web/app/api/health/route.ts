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
    // El detalle va al log del servidor, no a la respuesta pública (puede incluir host o
    // usuario de la base). Afuera solo se dice si falta la variable o si la base no responde.
    console.error("[health] la base no responde:", e instanceof Error ? e.message : e);
    const configured = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    return NextResponse.json(
      { ok: false, db: "down", reason: configured ? "unreachable" : "database_url_missing" },
      { status: 503 },
    );
  }
}
