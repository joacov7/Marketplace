import { NextResponse } from "next/server";
import { resolveConfigValue } from "@commerce/platform";
import { listPets, estimateConsumption, daysForBag, factorFor } from "@commerce/modules/pets";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Avisos de reposición: para el cliente logueado, estima cuándo se le acaba cada alimento
 * comprado según el consumo de su mascota (fórmula RER/MER + kcal/kg del alimento + peso de
 * la bolsa). Usa la mascota con peso cargado (la primera); es una estimación.
 */
export async function GET() {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const factors = (await resolveConfigValue<Record<string, number>>(db(), "nutrition.factors", { tenantId: session.tenantId })).value;

  const result = await db().withTenant(session.tenantId, async (tx) => {
    const pets = await listPets(tx, session.userId);
    const pet = pets.find((p) => p.weightKg && p.weightKg > 0);
    if (!pet || !pet.weightKg) return { pet: null, items: [] };

    const rows = await tx.query<{ order_id: string; created_at: string; qty: number; net_weight_kg: string; name: string; kcal_per_kg: number }>(
      `select o.id as order_id, o.created_at, oi.qty, v.net_weight_kg, pr.name, pr.kcal_per_kg
         from orders o
         join seller_orders so on so.order_id = o.id
         join order_items oi on oi.seller_order_id = so.id
         join variants v on v.id = oi.variant_id
         join products pr on pr.id = v.product_id
        where o.customer_id = $1 and o.status in ('confirmed','completed','partially_refunded')
          and pr.kcal_per_kg is not null and v.net_weight_kg is not null
        order by o.created_at desc
        limit 40`,
      [session.userId],
    );

    const factor = factorFor(pet.activity, factors);
    const now = Date.now();
    const items = rows.map((r) => {
      const c = estimateConsumption({ weightKg: pet.weightKg!, factor, kcalPerKg: r.kcal_per_kg });
      const totalDays = daysForBag(Number(r.net_weight_kg) * r.qty, c.gramsPerDay);
      const runOut = new Date(new Date(r.created_at).getTime() + totalDays * 86400000);
      const daysLeft = Math.round((runOut.getTime() - now) / 86400000);
      return {
        orderId: r.order_id,
        productName: r.name,
        purchasedAt: new Date(r.created_at).toISOString(),
        netKg: Number(r.net_weight_kg) * r.qty,
        gramsPerDay: c.gramsPerDay,
        totalDays,
        runOutAt: runOut.toISOString(),
        daysLeft,
      };
    });
    // El más urgente primero.
    items.sort((a, b) => a.daysLeft - b.daysLeft);
    return { pet: { name: pet.name, weightKg: pet.weightKg }, items };
  });

  return NextResponse.json(result);
}
