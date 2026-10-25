import { NextResponse } from "next/server";
import { listRewards, loyaltyBalance, loyaltyHistory, loyaltyRule } from "@commerce/modules/loyalty";
import { db } from "@/lib/db";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * "Mis puntos": saldo, últimos movimientos y premios del cliente LOGUEADO (tenant de su sesión).
 * No hay versión por teléfono a propósito: sin contraseña, cualquiera podría ver el saldo ajeno.
 */
export async function GET() {
  const session = readSession();
  if (!session?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await db().withTenant(session.tenantId, async (tx) => {
    const rule = await loyaltyRule(tx, session.tenantId);
    if (!rule.enabled) return { rule, balance: 0, history: [], rewards: [] };
    return {
      rule,
      balance: await loyaltyBalance(tx, session.userId),
      history: await loyaltyHistory(tx, session.userId, 20),
      rewards: await listRewards(tx, { activeOnly: true }),
    };
  });
  return NextResponse.json({
    enabled: data.rule.enabled,
    spendPerPointMinor: data.rule.spendPerPointMinor.toString(),
    balance: data.balance,
    history: data.history,
    rewards: data.rewards.map((r) => ({ name: r.name, pointsCost: r.pointsCost })),
  });
}
