import { NextResponse } from "next/server";
import { runCustomerAgent, deterministicResponder, type ResponderContext } from "@commerce/modules/agent";
import { getCustomer } from "@commerce/modules/customer";
import { listPets } from "@commerce/modules/pets";
import { resolveConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { readSession } from "@/lib/session";
import { makeVendorResponder } from "@/lib/vendor-responder";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_LEN = 500;

/**
 * Consulta al Vendedor IA (Customer Shopping Agent, conversacional). PROPOSE-ONLY: asesora,
 * recomienda y devuelve un carrito propuesto que el humano confirma por /api/checkout; el
 * agente nunca cobra. Activable por comercio (`features.aiAssistant`).
 *
 * `customerId` sale de la SESIÓN verificada (no del cliente), para no exponer el historial de
 * otro cliente del mismo tenant. El header `x-customer-id` queda solo como fallback de dev.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  // El comercio decide si el Vendedor existe (feature flag por tenant).
  const enabled = (await resolveConfigValue<boolean>(db(), "features.aiAssistant", { tenantId: tenant.tenantId })).value;
  if (enabled === false) return NextResponse.json({ disabled: true });

  let body: { message?: string; budgetMinor?: string | number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "missing_message" }, { status: 400 });
  }
  const message = body.message.trim().slice(0, MAX_MESSAGE_LEN);
  if (!message) return NextResponse.json({ error: "missing_message" }, { status: 400 });

  // Identidad del cliente desde la sesión (no falsificable). Header solo como fallback dev.
  const session = readSession();
  const customerId = session?.userId ?? req.headers.get("x-customer-id") ?? undefined;

  // Contexto para personalizar (la mascota es el centro). Best-effort: si falla, seguimos sin él.
  let context: ResponderContext | undefined;
  if (customerId) {
    try {
      const ctx = await db().withTenant(tenant.tenantId, async (tx) => {
        const customer = await getCustomer(tx, customerId);
        if (!customer) return undefined;
        const pets = await listPets(tx, customer.id);
        return { customerName: customer.name, petNames: pets.map((p) => p.name).filter(Boolean) } as ResponderContext;
      });
      context = ctx;
    } catch {
      /* personalización opcional */
    }
  }

  // El Vendedor con Claude (si hay ANTHROPIC_API_KEY). Si no, o si el LLM falla, cae al
  // responder determinista para no romper la experiencia.
  const vendor = makeVendorResponder();
  const responder = vendor
    ? {
        async compose(input: Parameters<typeof deterministicResponder.compose>[0]) {
          try {
            return await vendor.compose(input);
          } catch (e) {
            console.error("[vendor] LLM falló, uso responder determinista:", e);
            return deterministicResponder.compose(input);
          }
        },
      }
    : deterministicResponder;

  const r = await runCustomerAgent(db(), {
    tenantId: tenant.tenantId,
    message,
    ...(customerId ? { customerId } : {}),
    ...(body.budgetMinor !== undefined ? { budgetMinor: BigInt(body.budgetMinor) } : {}),
  }, {
    responder,
    ...(context ? { context } : {}),
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
