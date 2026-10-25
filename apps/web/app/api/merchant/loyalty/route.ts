import { NextResponse } from "next/server";
import { addLoyaltyPoints, listRewards, loyaltyRule, redeemReward, saveReward, topLoyaltyCustomers } from "@commerce/modules/loyalty";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_MESSAGE: Record<string, string> = {
  loyalty_disabled: "El club de puntos está apagado. Activalo en Configuración.",
  insufficient_points: "No le alcanzan los puntos.",
  reward_not_found: "Ese premio no existe o está desactivado.",
  customer_not_found: "No encontramos a ese cliente.",
  invalid_amount: "Ingresá el monto de la compra.",
  amount_too_low: "Con ese monto no llega a sumar un punto.",
  invalid_points: "Ingresá una cantidad de puntos válida.",
  note_required: "Escribí el motivo del ajuste.",
  invalid_name: "Escribí el nombre del premio.",
};

/** Club de puntos (panel): regla vigente, premios y clientes con más puntos. */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  const data = await db().withTenant(tenant.tenantId, async (tx) => ({
    rule: await loyaltyRule(tx, tenant.tenantId),
    rewards: await listRewards(tx),
    top: await topLoyaltyCustomers(tx, 20),
  }));
  return NextResponse.json({
    enabled: data.rule.enabled,
    spendPerPointMinor: data.rule.spendPerPointMinor.toString(),
    rewards: data.rewards,
    top: data.top,
  });
}

type Body =
  | { action: "reward"; id?: string; name?: string; pointsCost?: number; active?: boolean }
  | { action: "redeem"; customerId?: string; rewardId?: string }
  | { action: "points"; customerId?: string; kind?: "store" | "adjust"; amountMinor?: string | number; points?: number; note?: string };

/**
 * Acciones del panel: guardar un premio, canjear un premio de un cliente, o sumar/ajustar puntos
 * (compra en el local o corrección). Siempre con sesión admin del mismo comercio o código maestro.
 */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tid = tenant.tenantId;
  let res;
  if (body.action === "reward") {
    if (body.id !== undefined && !UUID.test(body.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    res = await db().withTenant(tid, (tx) =>
      saveReward(tx, {
        tenantId: tid,
        ...(body.id ? { id: body.id } : {}),
        name: String(body.name ?? ""),
        pointsCost: Number(body.pointsCost),
        active: body.active !== false,
      }),
    );
  } else if (body.action === "redeem") {
    if (!UUID.test(body.customerId ?? "") || !UUID.test(body.rewardId ?? "")) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    res = await db().withTenant(tid, (tx) => redeemReward(tx, { tenantId: tid, customerId: body.customerId!, rewardId: body.rewardId! }));
  } else if (body.action === "points") {
    if (!UUID.test(body.customerId ?? "")) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    if (body.kind !== "store" && body.kind !== "adjust") return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
    let amountMinor: bigint | undefined;
    if (body.kind === "store") {
      const raw = String(body.amountMinor ?? "");
      if (!/^\d{1,13}$/.test(raw)) return NextResponse.json({ error: "invalid_amount", message: ERROR_MESSAGE.invalid_amount }, { status: 400 });
      amountMinor = BigInt(raw);
    }
    res = await db().withTenant(tid, (tx) =>
      addLoyaltyPoints(tx, {
        tenantId: tid,
        customerId: body.customerId!,
        kind: body.kind as "store" | "adjust",
        ...(amountMinor !== undefined ? { amountMinor } : {}),
        ...(body.points !== undefined ? { points: Number(body.points) } : {}),
        ...(body.note ? { note: String(body.note) } : {}),
      }),
    );
  } else {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  if (!res.ok) return NextResponse.json({ error: res.error, message: ERROR_MESSAGE[res.error] }, { status: 409 });
  return NextResponse.json({ ok: true, ...res.value });
}
