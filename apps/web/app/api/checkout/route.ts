import { NextResponse } from "next/server";
import { getVariantWithPrice } from "@commerce/modules/catalog";
import { createOrder, cancelOrder, type PaymentMethod } from "@commerce/modules/orders";
import { createPaymentIntent } from "@commerce/modules/payments";
import { addAddress, ensureCustomerForUser, findOrCreateCustomerByPhone } from "@commerce/modules/customer";
import { zoneChargeByName, checkDeliveryRadius, cartHasFood, resolveMinOrderConfig, applyMinOrder } from "@commerce/modules/delivery";
import { createPet, listPets, type Species } from "@commerce/modules/pets";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";
import { rateLimited, rule, LIMITS } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";
import { normalizePhone } from "@commerce/modules/customer";
import { mercadoPagoCredentials, mercadoPagoProvider, publicOrigin, webhookUrl, MP_PAY_WINDOW_SECONDS } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

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

  // Anti-bots: cada pedido reserva stock (hasta 7 días si es pago al recibir). Sin límite, un
  // script deja el catálogo "sin stock". Por IP y por teléfono (contadores compartidos).
  const checkoutPhone = normalizePhone(body.phone ?? body.address?.phone);
  const limited = await rateLimited(
    [
      rule(`checkout:ip:${tenant.tenantId}:${clientIp(req)}`, LIMITS.checkoutPerIp),
      ...(checkoutPhone ? [rule(`checkout:phone:${tenant.tenantId}:${checkoutPhone}`, LIMITS.checkoutPerPhone)] : []),
    ],
    "Recibimos muchos pedidos seguidos desde acá. Esperá un rato o escribinos por WhatsApp.",
  );
  if (limited) return limited;

  const chain = { tenantId: tenant.tenantId };
  const [threshold, standardCost, auxilioCost, minOrderCfg] = await Promise.all([
    resolveConfigValue<number>(db(), "delivery.freeOverOrderTotalMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.customerChargeMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db(), "delivery.auxilioCostMinor", chain).then((r) => BigInt(r.value)),
    resolveMinOrderConfig(db(), tenant.tenantId),
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
    // ¿El carrito lleva alimento (ancla)? Define qué mínimo de envío rige.
    const hasFood = await cartHasFood(tx, body.items.map((i) => i.variantId));
    // Tarifa por zona (barrio) si matchea una zona configurada; si no, envío plano.
    const zone = body.address?.zone ? await zoneChargeByName(tx, body.address.zone) : null;
    const baseCharge = zone?.customerChargeMinor ?? standardCost;
    const deliveryChargeMinor = deliveryMethod === "auxilio" ? auxilioCost : gmv >= threshold ? 0n : baseCharge;
    return { merchantId: merchants[0].id, items, gmv, deliveryChargeMinor, hasFood };
  });
  if (!priced) return NextResponse.json({ error: "invalid_items_or_no_merchant" }, { status: 400 });

  // Mínimo de envío por segmento: con alimento rige el mínimo base; sin alimento (almacén puro),
  // el más alto. Se valida en el server (autoritativo) aunque la tienda ya lo muestre.
  const minOrder = applyMinOrder({ hasFood: priced.hasFood, gmvMinor: priced.gmv, config: minOrderCfg });
  if (!minOrder.meets) {
    return NextResponse.json(
      {
        error: "below_minimum",
        minMinor: minOrder.minMinor.toString(),
        missingMinor: minOrder.missingMinor.toString(),
        hasFood: minOrder.hasFood,
      },
      { status: 422 },
    );
  }

  // Radio de reparto: si el comercio configuró una geocerca y el cliente compartió su ubicación,
  // rechazamos el pedido cuando el punto cae fuera del radio. Sin ubicación no bloquea (la
  // ubicación es opcional): el comercio lo verá en el pedido y decide al aceptar.
  const radius = await checkDeliveryRadius(db(), {
    tenantId: tenant.tenantId,
    lat: body.address?.lat,
    lng: body.address?.lng,
  });
  if (radius.enabled && !radius.withinRadius) {
    return NextResponse.json(
      { error: "outside_delivery_radius", distanceKm: radius.distanceKm, radiusKm: radius.radiusKm },
      { status: 422 },
    );
  }

  const session = readSession();
  const isOnline = ONLINE_METHODS.has(body.payment ?? "");

  // "Pagar ahora" solo si el comercio conectó Mercado Pago (credenciales activas). Se valida
  // ANTES de crear el pedido para no reservar stock de un pedido que no se puede pagar.
  const mpCreds = isOnline ? await mercadoPagoCredentials(tenant.tenantId, priced.merchantId) : null;
  if (isOnline && !mpCreds?.enabled) {
    return NextResponse.json({ error: "mercadopago_unavailable" }, { status: 400 });
  }
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
    // Pago al recibir se acepta más tarde: retenemos el stock 7 días (no 15 min) para no
    // perderlo mientras el comercio decide. Online: el mismo plazo que tiene para pagar en MP
    // (la preferencia vence a la par; si no paga, la reserva vence sola).
    reservationTtlSeconds: isOnline ? MP_PAY_WINDOW_SECONDS : 7 * 24 * 3600,
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
  // comercio lo Acepta/Rechaza; el cobro se registra al entregar.
  // Pago online → preferencia de Mercado Pago (Checkout Pro). El cliente paga en MP y vuelve al
  // seguimiento; el pedido se confirma cuando MP aprueba (webhook o verificación al volver).
  let redirectUrl: string | null = null;
  if (isOnline && mpCreds) {
    const orderId = order.value.orderId;
    const origin = publicOrigin(req);
    const back = (estado: string) => `${origin}/seguimiento/${orderId}?tenant=${encodeURIComponent(tenant.slug)}&pago=${estado}`;
    const shopName = (await resolveConfigValue<string>(db(), "branding.displayName", chain)).value || tenant.name;
    const provider = mercadoPagoProvider(mpCreds, {
      notificationUrl: webhookUrl(origin, priced.merchantId, tenant.slug),
      backUrls: { success: back("aprobado"), pending: back("pendiente"), failure: back("error") },
      title: who.petName ? `Pedido de ${who.petName} — ${shopName}` : `Pedido ${shopName}`,
      statementDescriptor: shopName,
      expiresInSeconds: MP_PAY_WINDOW_SECONDS,
    });
    const intent = await createPaymentIntent(db(), provider, { tenantId: tenant.tenantId, orderId, idempotencyKey });
    if (!intent.ok || !intent.value.redirectUrl) {
      // No se pudo abrir el pago: cancelamos el pedido (libera el stock) para no dejarlo colgado.
      await cancelOrder(db(), tenant.tenantId, orderId).catch(() => {});
      console.error(`[checkout:mercadopago] tenant=${tenant.slug} order=${orderId} ${intent.ok ? "sin init_point" : intent.error}`);
      return NextResponse.json({ error: "mercadopago_error" }, { status: 502 });
    }
    redirectUrl = intent.value.redirectUrl;
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
      ...(redirectUrl ? { redirectUrl } : {}),
    },
    { status: 201 },
  );
}
