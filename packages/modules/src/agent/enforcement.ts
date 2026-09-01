import { type Result, ok, err } from "@commerce/contracts";

/**
 * Enforcement del Customer Shopping Agent (propose-only). La garantía "el agente no puede
 * gastar plata sin confirmación humana" ([S2]) es ESTRUCTURAL, no un pedido en el prompt:
 *  - El agente solo puede usar tools de su registro (lectura + preparación).
 *  - Las tools de dinero NO existen en su registro y están explícitamente prohibidas.
 *  - Un carrito "preparado" es inerte: no crea pedido ni pago (eso lo hace el humano vía
 *    /api/checkout).
 * Espeja el modelo de agent-core (autonomía + intercepción de tools de escritura) sin
 * tocar ese repo.
 */
export type ToolKind = "read" | "prepare";

export interface AgentToolDef {
  id: string;
  kind: ToolKind;
  description: string;
}

/** Tools permitidas al Customer Agent. Ninguna mueve dinero. */
export const CUSTOMER_AGENT_TOOLS: readonly AgentToolDef[] = [
  { id: "buscar_producto", kind: "read", description: "Busca productos en el catálogo." },
  { id: "recomendar", kind: "read", description: "Recomienda por historial/mascota/presupuesto." },
  { id: "comparar", kind: "read", description: "Compara productos (precio, stock)." },
  { id: "detectar_recompra", kind: "read", description: "Detecta productos de recompra por cadencia." },
  { id: "estimar_presupuesto", kind: "read", description: "Arma una compra dentro de un tope de gasto." },
  { id: "armar_carrito", kind: "prepare", description: "PREPARA un carrito propuesto (no lo compra)." },
] as const;

/** Tools de dinero: PROHIBIDAS para el agente. Solo el humano las dispara desde la UI. */
export const FORBIDDEN_MONEY_TOOLS: readonly string[] = [
  "checkout",
  "pay",
  "place_order",
  "create_payment",
  "capture_payment",
  "apply_refund",
] as const;

const ALLOWED = new Set(CUSTOMER_AGENT_TOOLS.map((t) => t.id));
const FORBIDDEN = new Set(FORBIDDEN_MONEY_TOOLS);

/** ¿Puede el agente usar esta tool? Falla cerrado: solo las del registro, nunca las de dinero. */
export function assertToolAllowed(toolId: string): Result<true, string> {
  if (FORBIDDEN.has(toolId)) return err(`tool de dinero prohibida para el agente: ${toolId}`);
  if (!ALLOWED.has(toolId)) return err(`tool no autorizada: ${toolId}`);
  return ok(true);
}

/**
 * Presupuesto de IA por tenant (espeja el AI Gateway de agent-core): falla cerrado al
 * superarlo. Evita que el agente gaste IA sin límite (sección 18: costo de IA controlado).
 */
export class AiBudgetGuard {
  private spent = 0n;
  constructor(private readonly limitMinor: bigint) {}

  /** Registra un gasto; devuelve error si supera el límite (sin aplicar el gasto). */
  charge(costMinor: bigint): Result<{ spent: bigint }, "budget_exceeded"> {
    if (this.spent + costMinor > this.limitMinor) return err("budget_exceeded");
    this.spent += costMinor;
    return ok({ spent: this.spent });
  }

  get spentMinor(): bigint {
    return this.spent;
  }
}
