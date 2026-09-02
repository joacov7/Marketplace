import { NextResponse } from "next/server";
import { createPet, listPets, DEFAULT_FACTORS, type Species } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const SPECIES: Species[] = ["perro", "gato", "otro"];

/** Mascotas del cliente logueado. */
export async function GET() {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pets = await db().withTenant(session.tenantId, (tx) => listPets(tx, session.userId));
  return NextResponse.json({ pets, activities: Object.keys(DEFAULT_FACTORS) });
}

/** Registra una mascota. */
export async function POST(req: Request) {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { name?: string; species?: string; breed?: string; weightKg?: number; activity?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "missing_name" }, { status: 400 });

  const species = (SPECIES as string[]).includes(body.species ?? "") ? (body.species as Species) : "perro";
  const activity = body.activity && body.activity in DEFAULT_FACTORS ? body.activity : "adulto_normal";
  const weightKg = Number(body.weightKg);
  const result = await db().withTenant(session.tenantId, (tx) =>
    createPet(tx, {
      tenantId: session.tenantId,
      customerId: session.userId,
      name: body.name!.trim(),
      species,
      activity,
      ...(body.breed?.trim() ? { breed: body.breed.trim() } : {}),
      ...(Number.isFinite(weightKg) && weightKg > 0 ? { weightKg } : {}),
    }),
  );
  return NextResponse.json(result, { status: 201 });
}
