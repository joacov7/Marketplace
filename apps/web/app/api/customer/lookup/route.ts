import { NextResponse } from "next/server";
import { findCustomerByPhone, normalizePhone } from "@commerce/modules/customer";
import { listPets } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { phoneLookupLimited } from "@/lib/abuse";

export const dynamic = "force-dynamic";

// Este endpoint es público (lo usa el checkout para reconocer al cliente por teléfono) y
// devuelve nombre + mascotas. Sin límite, es un oráculo para enumerar teléfonos y cosechar
// datos personales. Mitigaciones: (1) límite por IP y por teléfono, (2) exigir un teléfono completo
// (mín. de dígitos) para que no se pueda sondear por prefijos cortos.
const MIN_PHONE_DIGITS = 8;

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

  // Límite compartido (todas las instancias) por IP y por teléfono: frena la enumeración
  // masiva de teléfonos para cosechar nombres + mascotas.
  const limited = await phoneLookupLimited(req, tenant.tenantId, url.searchParams.get("phone") ?? "");
  if (limited) return limited;

  const phone = normalizePhone(url.searchParams.get("phone"));
  // Exigimos un teléfono completo: no respondemos a prefijos cortos (evita sondeo).
  if (phone.length < MIN_PHONE_DIGITS) return NextResponse.json({ found: false, pets: [] });

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
