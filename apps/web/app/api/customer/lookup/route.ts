import { NextResponse } from "next/server";
import { findCustomerByPhone, normalizePhone } from "@commerce/modules/customer";
import { listPets } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Reconoce a un cliente por teléfono para el checkout ("¿Ya nos compraste antes?"). Si existe,
 * devuelve su nombre y sus mascotas para saludarlo y ofrecer "¿Para quién compramos hoy?".
 * No expone datos sensibles (ni direcciones ni historial): solo nombre + mascotas, lo justo
 * para personalizar. Corre con contexto de tenant (RLS) → aislado por comercio.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const phone = normalizePhone(url.searchParams.get("phone"));
  if (!phone) return NextResponse.json({ found: false, pets: [] });

  const result = await db().withTenant(tenant.tenantId, async (tx) => {
    const customer = await findCustomerByPhone(tx, phone);
    if (!customer) return { found: false, name: null, pets: [] as unknown[] };
    const pets = await listPets(tx, customer.id);
    return {
      found: true,
      name: customer.name,
      pets: pets.map((p) => ({ id: p.id, name: p.name, species: p.species })),
    };
  });
  return NextResponse.json(result);
}
