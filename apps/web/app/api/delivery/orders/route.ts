import { NextResponse } from "next/server";
import { listDeliveryOrders, type DeliveryOrderRow } from "@commerce/modules/orders";
import { mapsRouteLinks, planDeliveryRoute, resolveRadiusConfig } from "@commerce/modules/delivery";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { deliveryAccessDenied } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Ciudad que se suma a las direcciones escritas para que Google Maps las encuentre.
const CITY = "Gualeguay, Entre Ríos";

/** Franja base del pedido (día + turno), sin la preferencia libre del cliente ("· Prefiere: …"). */
const baseWindow = (w: string | null) => (w ?? "Sin horario asignado").split(" · Prefiere:")[0]!;

/** Destino para Google Maps: el pin exacto si el cliente lo compartió, si no la dirección escrita. */
const place = (r: DeliveryOrderRow) =>
  r.addressLat != null && r.addressLng != null
    ? `${r.addressLat},${r.addressLng}`
    : [r.addressStreet, r.addressZone, CITY].filter(Boolean).join(", ");

/**
 * Cola de reparto (pantalla del cadete): pedidos listos para salir o en camino, con dirección,
 * referencias, teléfono del cliente, mascota y monto a cobrar. Acceso por PIN de reparto del
 * tenant (o token de admin). Corre con contexto de tenant (RLS).
 */
export async function GET(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  // Esta cola expone PII del cliente (nombre, teléfono, dirección): acceso por PIN con bloqueo
  // por intentos fallidos (ver lib/delivery-access.ts).
  const denied = await deliveryAccessDenied(req, tenant.tenantId);
  if (denied) return denied;

  const { rows, radius } = await db().withTenant(tenant.tenantId, async (tx) => ({
    rows: await listDeliveryOrders(tx),
    radius: await resolveRadiusConfig(tx, tenant.tenantId),
  }));

  // Recorrido sugerido: por franja y, dentro de cada una, desde el local (pin de Configuración).
  const origin = radius.centerLat !== 0 || radius.centerLng !== 0 ? { lat: radius.centerLat, lng: radius.centerLng } : null;
  const byId = new Map(rows.map((r) => [r.sellerOrderId, r]));
  const groups = planDeliveryRoute(
    rows.map((r) => ({ id: r.sellerOrderId, window: baseWindow(r.deliveryWindow), zone: r.addressZone, lat: r.addressLat, lng: r.addressLng })),
    origin,
  );
  const ordered = groups.flatMap((g) => g.stops.map((s, i) => ({ row: byId.get(s.id)!, stopNumber: i + 1 })));

  return NextResponse.json({
    routes: groups.map((g) => ({
      window: g.window,
      stops: g.stops.length,
      withoutLocation: g.withoutLocation,
      estimatedKm: g.estimatedKm,
      fromShop: origin !== null,
      links: mapsRouteLinks(g.stops, origin, (s) => place(byId.get(s.id)!)),
    })),
    orders: ordered.map(({ row: r, stopNumber }) => ({
      stopNumber,
      routeWindow: baseWindow(r.deliveryWindow),
      sellerOrderId: r.sellerOrderId,
      orderId: r.orderId,
      status: r.status,
      petName: r.petName,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      addressStreet: r.addressStreet,
      addressZone: r.addressZone,
      addressNotes: r.addressNotes,
      addressLat: r.addressLat,
      addressLng: r.addressLng,
      deliveryWindow: r.deliveryWindow,
      amountToCollectMinor: r.amountToCollectMinor.toString(),
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      items: r.items,
      createdAt: r.createdAt,
    })),
  });
}
