import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { createOrder, confirmOrder, type OrderChannel, type PaymentMethod, type PaymentStatus } from "@commerce/modules/orders";
import { findOrCreateCustomerByPhone } from "@commerce/modules/customer";
import { createPet, listPets, type Species } from "@commerce/modules/pets";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface ManualBody {
  phone?: string;
  customerName?: string;
  petId?: string;
  petName?: string;
  petSpecies?: string;
  petWeightKg?: number;
  items?: Array<{ variantId: string; qty: number }>;
  address?: { street?: string; city?: string; zone?: string; notes?: string };
  channel?: string;
  paymentMethod?: string;
  paymentStatus?: string;
}

const CHANNELS = new Set(["whatsapp", "telefono", "mostrador"]);
const METHODS = new Set(["efectivo", "pos", "transferencia", "online"]);
const SPECIES = new Set(["perro", "gato", "otro"]);

/**
 * Pedido MANUAL desde el panel: para lo que llega por WhatsApp, teléfono o mostrador. NO es
 * un sistema aparte — usa el mismo Order del ecommerce, así que aparece junto a los pedidos
 * web, en el historial del cliente y de la mascota, y en los reportes. Convierte el chat en
 * un pedido real (clave para la estadística y la recompra). El comercio lo carga, así que
 * entra ya ACEPTADO (confirmed). Gated por token de servicio.
 */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: ManualBody;
  try {
    body = (await req.json()) as ManualBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const phone = body.phone?.trim();
  if (!phone) return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "empty_cart" }, { status: 400 });
  }

  const channel: OrderChannel = CHANNELS.has(body.channel ?? "") ? (body.channel as OrderChannel) : "mostrador";
  const paymentMethod: PaymentMethod = METHODS.has(body.paymentMethod ?? "") ? (body.paymentMethod as PaymentMethod) : "efectivo";
  const paymentStatus: PaymentStatus = body.paymentStatus === "pagado" ? "pagado" : "pendiente";

  const chain = { tenantId: tenant.tenantId };
  const [threshold, standardCost] = await Promise.all([
    resolveConfigValue<number>(db(), "delivery.freeOverOrderTotalMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.customerChargeMinor", chain).then((r) => BigInt(r.value)),
  ]);

  const prepared = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return { error: "no_merchant" as const };

    // Cliente por teléfono (ficha reutilizable, sin duplicar).
    const { customerId } = await findOrCreateCustomerByPhone(tx, {
      tenantId: tenant.tenantId,
      phone,
      ...(body.customerName?.trim() ? { name: body.customerName.trim() } : {}),
    });

    // Mascota: existente del cliente, o alta rápida.
    let petId: string | null = null;
    let petName: string | null = body.petName?.trim() || null;
    const pets = await listPets(tx, customerId);
    if (body.petId && pets.some((p) => p.id === body.petId)) {
      const p = pets.find((x) => x.id === body.petId)!;
      petId = p.id;
      petName = p.name;
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

    // Precios actuales del catálogo (misma lógica que el checkout web).
    const items = [];
    let gmv = 0n;
    for (const it of body.items!) {
      const v = await getVariantWithPrice(tx, it.variantId);
      if (!v || !v.price) return { error: "invalid_item" as const };
      const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
      items.push({ variantId: it.variantId, qty, unitPriceMinor: v.price.amountMinor });
      gmv += v.price.amountMinor * BigInt(qty);
    }
    // Envío: solo si hay dirección (mostrador = retiro, sin envío). Config-driven.
    const hasAddress = !!body.address?.street?.trim();
    const deliveryChargeMinor = hasAddress ? (gmv >= threshold ? 0n : standardCost) : 0n;

    return { merchantId: merchants[0].id, customerId, petId, petName, items, gmv, deliveryChargeMinor, hasAddress };
  });

  if ("error" in prepared) {
    const status = prepared.error === "no_merchant" ? 400 : 400;
    return NextResponse.json({ error: prepared.error }, { status });
  }

  const order = await createOrder(db(), {
    tenantId: tenant.tenantId,
    customerId: prepared.customerId,
    ...(prepared.petId ? { petId: prepared.petId } : {}),
    ...(prepared.petName ? { petName: prepared.petName } : {}),
    paymentMethod,
    paymentStatus,
    channel,
    ...(prepared.hasAddress
      ? { shippingAddress: { ...body.address, paymentMethod } as Record<string, unknown> }
      : {}),
    deliveryChargeMinor: prepared.deliveryChargeMinor,
    sellers: [{ merchantId: prepared.merchantId, items: prepared.items }],
  });
  if (!order.ok) return NextResponse.json({ error: order.error }, { status: 409 });

  // El comercio lo cargó → ya aceptado (confirmado). El pago sigue pendiente o pagado según
  // lo elegido (pago al recibir vs. cobrado en el momento).
  const confirmed = await confirmOrder(db(), tenant.tenantId, order.value.orderId);
  if (!confirmed.ok) return NextResponse.json({ error: confirmed.error }, { status: 409 });

  return NextResponse.json(
    {
      orderId: order.value.orderId,
      petName: prepared.petName,
      totalMinor: (prepared.gmv + prepared.deliveryChargeMinor).toString(),
      channel,
      paymentMethod,
      paymentStatus,
    },
    { status: 201 },
  );
}
