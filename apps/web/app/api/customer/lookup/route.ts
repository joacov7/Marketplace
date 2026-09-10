import { NextResponse } from "next/server";
import { findCustomerByPhone, normalizePhone } from "@commerce/modules/customer";
import { listPets } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Este endpoint es público (lo usa el checkout para reconocer al cliente por teléfono) y
// devuelve nombre + mascotas. Sin límite, es un oráculo para enumerar teléfonos y cosechar
// datos personales. Mitigaciones: (1) rate limit por IP, (2) exigir un teléfono completo
// (mín. de dígitos) para que no se pueda sondear por prefijos cortos.
const LOOKUP_LIMIT = 15; // consultas
const LOOKUP_WINDOW_MS = 60_000; // por minuto por IP
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

  // Rate limit por IP (best-effort) para frenar la enumeración masiva de teléfonos.
  const rl = rateLimit(`lookup:${tenant.tenantId}:${clientIp(req)}`, LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

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
