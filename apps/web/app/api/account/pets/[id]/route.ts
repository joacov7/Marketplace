import { NextResponse } from "next/server";
import { updatePet, deletePet, DEFAULT_FACTORS, type Species } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const SPECIES: Species[] = ["perro", "gato", "otro"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { name?: string; species?: string; breed?: string; weightKg?: number; activity?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const weightKg = body.weightKg !== undefined ? Number(body.weightKg) : undefined;

  await db().withTenant(session.tenantId, (tx) =>
    updatePet(tx, {
      id: params.id,
      customerId: session.userId,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.species !== undefined && (SPECIES as string[]).includes(body.species) ? { species: body.species as Species } : {}),
      ...(body.breed !== undefined ? { breed: body.breed.trim() || null } : {}),
      ...(weightKg !== undefined ? { weightKg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null } : {}),
      ...(body.activity !== undefined && body.activity in DEFAULT_FACTORS ? { activity: body.activity } : {}),
    }),
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await db().withTenant(session.tenantId, (tx) => deletePet(tx, params.id, session.userId));
  return NextResponse.json({ ok: true });
}
