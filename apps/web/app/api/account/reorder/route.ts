import { NextResponse } from "next/server";
import { lastReorder } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Compra rápida del cliente logueado: items de su última compra (o de `?orderId=`) con precio y
 * stock ACTUALES, para "Repetir compra" en 1 clic. El agregado al carrito lo hace el cliente.
 */
export async function GET(req: Request) {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orderId = new URL(req.url).searchParams.get("orderId") ?? undefined;

  const r = await db().withTenant(session.tenantId, (tx) => lastReorder(tx, session.userId, orderId));
  if (!r) return NextResponse.json({ reorder: null });

  return NextResponse.json({
    reorder: {
      orderId: r.orderId,
      petName: r.petName,
      createdAt: r.createdAt,
      items: r.items.map((it) => ({
        variantId: it.variantId,
        name: it.name,
        size: it.size,
        qty: it.qty,
        priceMinor: it.priceMinor != null ? it.priceMinor.toString() : null,
        available: it.available,
      })),
    },
  });
}
