import { NextResponse } from "next/server";
import { runCustomerAgent } from "@commerce/modules/agent";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Consulta al Customer Shopping Agent. PROPOSE-ONLY: devuelve un carrito propuesto que el
 * humano debe confirmar por /api/checkout; el agente nunca cobra.
 *
 * `customerId` se toma del header `x-customer-id` (placeholder de sesión en dev). Con auth
 * real debe venir de la sesión verificada, NO del cliente, para no exponer el historial de
 * otro cliente del mismo tenant.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { message?: string; budgetMinor?: string | number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "missing_message" }, { status: 400 });
  }

  // La identidad del cliente sale de la SESIÓN (no falsificable). El header queda solo
  // como fallback de desarrollo cuando no hay sesión.
  const session = readSession();
  const customerId = session?.userId ?? req.headers.get("x-customer-id") ?? undefined;

  const r = await runCustomerAgent(db(), {
    tenantId: tenant.tenantId,
    message: body.message,
    ...(customerId ? { customerId } : {}),
    ...(body.budgetMinor !== undefined ? { budgetMinor: BigInt(body.budgetMinor) } : {}),
  });

  return NextResponse.json({
    reply: r.reply,
    requiresHumanConfirmation: r.requiresHumanConfirmation,
    usedTools: r.usedTools,
    proposedCart: r.proposedCart
      ? {
          items: r.proposedCart.items.map((i) => ({
            variantId: i.variantId,
            name: i.name,
            qty: i.qty,
            unitPriceMinor: i.unitPriceMinor.toString(),
          })),
          totalMinor: r.proposedCart.totalMinor.toString(),
          currency: r.proposedCart.currency,
          withinBudget: r.proposedCart.withinBudget,
        }
      : null,
  });
}
