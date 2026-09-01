import type { TenantAwareDb, Db } from "@commerce/platform";
import { AiBudgetGuard } from "./enforcement.js";
import { searchProducts, detectRepurchase, assembleProposedCart } from "./tools.js";
import type { AgentQuery, AgentResponse, ProductHit, RepurchaseHit, ProposedCart } from "./types.js";

/**
 * Responder de texto. El default es DETERMINISTA (sin LLM): compone la respuesta a partir
 * de los resultados. Un `AiTextResponder` real (agent-core / un LLM) se inyecta sin tocar
 * la orquestación — misma inversión de dependencia que el AI Gateway de agent-core.
 */
export interface AiTextResponder {
  compose(input: { message: string; hits: ProductHit[]; repurchase: RepurchaseHit[]; cart: ProposedCart }): string;
}

export const deterministicResponder: AiTextResponder = {
  compose({ hits, repurchase, cart }) {
    const parts: string[] = [];
    if (repurchase.length > 0) {
      parts.push(`Vi que ya compraste ${repurchase.slice(0, 3).map((r) => r.name).join(", ")}.`);
    }
    if (hits.length > 0) {
      parts.push(`Encontré ${hits.length} opción(es) que pueden servirte.`);
    } else {
      parts.push("No encontré productos que coincidan con tu búsqueda.");
    }
    if (cart.items.length > 0) {
      const pesos = (Number(cart.totalMinor) / 100).toLocaleString("es-AR", { style: "currency", currency: cart.currency });
      parts.push(`Te preparé un carrito por ${pesos}. Revisalo y confirmá vos el pago.`);
    }
    return parts.join(" ");
  },
};

function keywords(message: string): string[] {
  const stop = new Set(["para", "necesito", "quiero", "mi", "de", "la", "el", "un", "una", "con", "que", "por"]);
  return Array.from(
    new Set(
      message
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stop.has(w)),
    ),
  );
}

async function searchByMessage(db: Db, message: string, limit: number): Promise<ProductHit[]> {
  const words = keywords(message);
  if (words.length === 0) return searchProducts(db, { query: "", limit, inStockOnly: true });
  const seen = new Map<string, ProductHit>();
  for (const w of words) {
    for (const hit of await searchProducts(db, { query: w, limit, inStockOnly: true })) {
      if (!seen.has(hit.variantId)) seen.set(hit.variantId, hit);
    }
  }
  return Array.from(seen.values()).slice(0, limit);
}

export interface AgentDeps {
  responder?: AiTextResponder;
  budget?: AiBudgetGuard;
  /** Costo de IA imputado por consulta (por defecto $10 = 1000 c). */
  aiCostPerQueryMinor?: bigint;
}

/**
 * Ejecuta el Customer Shopping Agent. PROPOSE-ONLY: busca, detecta recompra y PREPARA un
 * carrito, pero jamás crea pedido ni pago (este módulo ni siquiera importa esa capa). El
 * humano confirma el pago aparte. Respeta un presupuesto de IA por tenant (falla cerrado).
 */
export async function runCustomerAgent(db: TenantAwareDb, query: AgentQuery, deps: AgentDeps = {}): Promise<AgentResponse> {
  const responder = deps.responder ?? deterministicResponder;
  const budget = deps.budget ?? new AiBudgetGuard(10_000_000n); // límite amplio por defecto
  const cost = deps.aiCostPerQueryMinor ?? 1000n;

  const charged = budget.charge(cost);
  if (!charged.ok) {
    return {
      reply: "Alcanzaste el límite de uso del asistente por ahora. Probá más tarde.",
      proposedCart: null,
      usedTools: [],
      requiresHumanConfirmation: true,
    };
  }

  return db.withTenant(query.tenantId, async (tx) => {
    const usedTools: string[] = [];

    const hits = await searchByMessage(tx, query.message, 5);
    usedTools.push("buscar_producto");

    let repurchase: RepurchaseHit[] = [];
    if (query.customerId) {
      repurchase = await detectRepurchase(tx, query.customerId);
      usedTools.push("detectar_recompra");
    }

    const seed =
      repurchase.length > 0
        ? repurchase.slice(0, 3).map((r) => ({ variantId: r.variantId, qty: 1 }))
        : hits.slice(0, 1).map((h) => ({ variantId: h.variantId, qty: 1 }));

    const cart = await assembleProposedCart(tx, {
      items: seed,
      ...(query.budgetMinor !== undefined ? { budgetMinor: query.budgetMinor } : {}),
    });
    usedTools.push("armar_carrito");

    const reply = responder.compose({ message: query.message, hits, repurchase, cart });

    return {
      reply,
      proposedCart: cart.items.length > 0 ? cart : null,
      usedTools,
      requiresHumanConfirmation: true,
    };
  });
}
