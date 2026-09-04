import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { createOrder, type PaymentMethod } from "@commerce/modules/orders";
import { createPaymentIntent, FakePaymentProvider } from "@commerce/modules/payments";
import { addAddress, ensureCustomerForUser, findOrCreateCustomerByPhone } from "@commerce/modules/customer";
import { zoneChargeByName } from "@commerce/modules/delivery";
import { createPet, listPets, type Species } from "@commerce/modules/pets";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// V1: proveedor "fake" (pago a la operación propia). Se reemplaza por Mercado Pago sin
// tocar este handler (Payment Orchestrator).
const provider = new FakePaymentProvider();

interface Addr { street?: string; city?: string; zone?: string; phone?: string; notes?: string; label?: string; lat?: number; lng?: number }
interface CheckoutBody {
  items: Array<{ variantId: string; qty: number }>;
  address?: Addr;
  deliveryWindow?: string;
  delivery?: "estandar" | "auxilio";
  payment?: "transferencia" | "mercadopago" | "efectivo" | "pos";
  // Cliente por teléfono (sin obligar a registrarse) + mascota protagonista.
  phone?: string;
  customerName?: string;
  petId?: string;
  petName?: string;
  petSpecies?: string;
  petWeightKg?: number;
}

const DELIVERY_LABEL: Record<string, string> = {
  estandar: "Envío estándar (13:00–20:00)",
  auxilio: "Envío de Auxilio (20:00–23:00)",
};

// Pago online (se captura por webhook) vs. pago al recibir (queda pendiente hasta la entrega).
const ONLINE_METHODS = new Set(["mercadopago"]);
function methodFor(p: string | undefined): PaymentMethod {
  if (p === "mercadopago") return "online";
  if (p === "efectivo") return "efectivo";
  if (p === "pos") return "pos";
  return "transferencia";
}
const SPECIES = new Set(["perro", "gato", "otro"]);

export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) return NextResponse.json({ error: "missing_idempotency_key" }, { status: 400 });

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "empty_cart" }, { status: 400 });
  }

  const chain = { tenantId: tenant.tenantId };
  const [threshold, standardCost, auxilioCost] = await Promise.all([
    resolveConfigValue<number>(db(), "delivery.freeOverOrderTotalMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.customerChargeMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.auxilioCostMinor", chain).then((r) => BigInt(r.value)),
  ]);
  const deliveryMethod = body.delivery === "auxilio" ? "auxilio" : "estandar";

  // Precios actuales + merchant + envío desde config/zona (una lectura con contexto de tenant).
  const priced = await db().withTenant(tenant.tenantId, async (tx) => {
    const merchants = await tx.query<{ id: string }>("select id from merchants order by created_at limit 1");
    if (!merchants[0]) return null;
    const items = [];
    let gmv = 0n;
    for (const it of body.items) {
      const v = await getVariantWithPrice(tx, it.variantId);
      if (!v || !v.price) return null;
      items.push({ variantId: it.variantId, qty: it.qty, unitPriceMinor: v.price.amountMinor });
      gmv += v.price.amountMinor * BigInt(it.qty);
    }
    // Tarifa por zona (barrio) si matchea una zona configurada; si no, envío plano.
    const zone = body.address?.zone ? await zoneChargeByName(tx, body.address.zone) : null;
    const baseCharge = zone?.customerChargeMinor ?? standardCost;
    const deliveryChargeMinor = deliveryMethod === "auxilio" ? auxilioCost : gmv >= threshold ? 0n : baseCharge;
    return { merchantId: merchants[0].id, items, gmv, deliveryChargeMinor };
  });
  if (!priced) return NextResponse.json({ error: "invalid_items_or_no_merchant" }, { status: 400 });

  const session = readSession();
  const isOnline = ONLINE_METHODS.has(body.payment ?? "");
  const paymentMethod = methodFor(body.payment);
  const phone = body.phone?.trim();

  // Identificar al cliente + su mascota. Prioriza capturar el dato sin bloquear la compra:
  // logueado → su ficha (id = userId); si no, por teléfono → ficha reutilizable; anónimo si no
  // hay ninguno (guest sin teléfono). La mascota se asocia a esa ficha y se guarda su nombre.
  const who = await db().withTenant(tenant.tenantId, async (tx) => {
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

    // Mascota: existente (validar que sea del cliente) o alta rápida con lo que haya.
    let petId: string | null = null;
    let petName: string | null = body.petName?.trim() || null;
    if (customerId) {
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
    }
    return { customerId, petId, petName };
  });

  const deliveryWindow = body.deliveryWindow || DELIVERY_LABEL[deliveryMethod];

  const order = await createOrder(db(), {
    tenantId: tenant.tenantId,
    ...(who.customerId ? { customerId: who.customerId } : {}),
    ...(who.petId ? { petId: who.petId } : {}),
    ...(who.petName ? { petName: who.petName } : {}),
    paymentMethod,
    paymentStatus: "pendiente",
    channel: "web",
    ...(body.address ? { shippingAddress: { ...body.address, paymentMethod: body.payment ?? null } as Record<string, unknown> } : {}),
    deliveryWindow,
    deliveryChargeMinor: priced.deliveryChargeMinor,
    sellers: [{ merchantId: priced.merchantId, items: priced.items }],
  });
  if (!order.ok) return NextResponse.json({ error: order.error }, { status: 409 });

  // Guardar la dirección en la libreta del cliente (best-effort), sea logueado o por teléfono.
  if (who.customerId && body.address?.street) {
    await db()
      .withTenant(tenant.tenantId, (tx) =>
        addAddress(tx, {
          tenantId: tenant.tenantId,
          customerId: who.customerId!,
          street: body.address!.street!,
          ...(body.address!.city ? { city: body.address!.city } : {}),
          ...(body.address!.zone ? { zone: body.address!.zone } : {}),
          ...(body.address!.notes ? { notes: body.address!.notes } : {}),
          ...(body.address!.label ? { label: body.address!.label } : {}),
        }),
      )
      .catch(() => {});
  }

  // Pago al recibir → NO se cobra ahora: el pedido queda "a aceptar" (pending_payment) y el
  // comercio lo Acepta/Rechaza; el cobro se registra al entregar (fuera de este eslabón).
  // Pago online → intent (V1 fake; MP se enchufa después) para capturar por webhook.
  let providerRef: string | null = null;
  if (isOnline) {
    const intent = await createPaymentIntent(db(), provider, {
      tenantId: tenant.tenantId,
      orderId: order.value.orderId,
      idempotencyKey,
    });
    if (!intent.ok) return NextResponse.json({ error: intent.error }, { status: 500 });
    providerRef = intent.value.providerRef;
  }

  return NextResponse.json(
    {
      orderId: order.value.orderId,
      gmvMinor: priced.gmv.toString(),
      deliveryChargeMinor: priced.deliveryChargeMinor.toString(),
      totalMinor: (priced.gmv + priced.deliveryChargeMinor).toString(),
      petName: who.petName,
      paymentMethod,
      payOnDelivery: !isOnline,
      ...(providerRef ? { providerRef } : {}),
    },
    { status: 201 },
  );
}
