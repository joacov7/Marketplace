import { NextResponse } from "next/server";
import { createSubscription, listCustomerSubscriptions } from "@commerce/modules/subscriptions";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { ensureCustomerForUser, findOrCreateCustomerByPhone, findCustomerByPhone } from "@commerce/modules/customer";
import { createPet, listPets, type Species } from "@commerce/modules/pets";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const SPECIES = new Set(["perro", "gato", "otro"]);
const PAY = new Set(["efectivo", "pos", "transferencia"]);

interface Body {
  variantId?: string;
  qty?: number;
  intervalDays?: number;
  phone?: string;
  customerName?: string;
  paymentMethod?: string;
  petId?: string;
  petName?: string;
  petSpecies?: string;
  petWeightKg?: number;
  address?: { street?: string; zone?: string; phone?: string; notes?: string; lat?: number; lng?: number };
}

/** Crea una suscripción de auto-envío. Activable por comercio (`features.subscriptions`). */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const enabled = (await resolveConfigValue<boolean>(db(), "features.subscriptions", { tenantId: tenant.tenantId })).value;
  if (enabled === false) return NextResponse.json({ error: "disabled" }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.variantId) return NextResponse.json({ error: "missing_variant" }, { status: 400 });
  const qty = Math.max(1, Math.round(Number(body.qty ?? 1)));
  const intervalDays = Math.round(Number(body.intervalDays));
  if (!Number.isFinite(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    return NextResponse.json({ error: "invalid_interval" }, { status: 400 });
  }
  const paymentMethod = PAY.has(body.paymentMethod ?? "") ? (body.paymentMethod as "efectivo" | "pos" | "transferencia") : "efectivo";

  const session = readSession();
  const phone = (body.address?.phone || body.phone || "").trim();
  const discount = (await resolveConfigValue<number>(db(), "subscriptions.discountPercent", { tenantId: tenant.tenantId })).value ?? 0;

  const prepared = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return null;
    const v = await getVariantWithPrice(tx, body.variantId!);
    if (!v || !v.price) return null;

    // Identidad del cliente: logueado (id = userId) o por teléfono (ficha reutilizable).
    let customerId: string | null = null;
    if (session?.userId) {
      customerId = (await ensureCustomerForUser(tx, {
        tenantId: tenant.tenantId,
        userId: session.userId,
        ...(body.customerName?.trim() ? { name: body.customerName.trim() } : {}),
        ...(phone ? { phone } : {}),
      })).customerId;
    } else if (phone) {
      customerId = (await findOrCreateCustomerByPhone(tx, {
        tenantId: tenant.tenantId,
        phone,
        ...(body.customerName?.trim() ? { name: body.customerName.trim() } : {}),
      })).customerId;
    }

    // Mascota: existente (del cliente) o alta rápida.
    let petId: string | null = null;
    let petName: string | null = body.petName?.trim() || null;
    if (customerId) {
      const pets = await listPets(tx, customerId);
      const existing = body.petId ? pets.find((p) => p.id === body.petId) : undefined;
      if (existing) {
        petId = existing.id;
        petName = existing.name;
      } else if (petName) {
        const species = SPECIES.has(body.petSpecies ?? "") ? (body.petSpecies as Species) : undefined;
        const weightKg = Number(body.petWeightKg);
        const created = await createPet(tx, {
          tenantId: tenant.tenantId,
          customerId,
          name: petName,
          ...(species ? { species } : {}),
          ...(Number.isFinite(weightKg) && weightKg > 0 ? { weightKg } : {}),
        });
        petId = created.id;
      }
    }
    return { merchantId: merchants[0].id, customerId, petId, petName };
  });

  if (!prepared) return NextResponse.json({ error: "invalid_variant_or_no_merchant" }, { status: 400 });

  const res = await createSubscription(db(), {
    tenantId: tenant.tenantId,
    merchantId: prepared.merchantId,
    variantId: body.variantId,
    qty,
    intervalDays,
    paymentMethod,
    discountPercent: discount,
    ...(prepared.customerId ? { customerId: prepared.customerId } : {}),
    ...(prepared.petId ? { petId: prepared.petId } : {}),
    ...(prepared.petName ? { petName: prepared.petName } : {}),
    ...(body.address ? { ship: {
      ...(body.address.street ? { street: body.address.street } : {}),
      ...(body.address.zone ? { zone: body.address.zone } : {}),
      ...(phone ? { phone } : {}),
      ...(body.address.notes ? { notes: body.address.notes } : {}),
      ...(body.address.lat != null ? { lat: body.address.lat } : {}),
      ...(body.address.lng != null ? { lng: body.address.lng } : {}),
    } } : {}),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  return NextResponse.json({ id: res.value.id, nextRunAt: res.value.nextRunAt, petName: prepared.petName }, { status: 201 });
}

/** Lista las suscripciones del cliente (por sesión o por teléfono). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const session = readSession();
  const phoneParam = url.searchParams.get("phone");

  const subs = await db().withTenant(tenant.tenantId, async (tx) => {
    let customerId: string | null = session?.userId ?? null;
    if (!customerId && phoneParam) {
      const c = await findCustomerByPhone(tx, phoneParam);
      customerId = c?.id ?? null;
    }
    if (!customerId) return [];
    return listCustomerSubscriptions(tx, customerId);
  });

  return NextResponse.json({ subscriptions: subs });
}
