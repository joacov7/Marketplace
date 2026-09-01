import { describe, it, expect } from "vitest";
import {
  assertToolAllowed,
  CUSTOMER_AGENT_TOOLS,
  FORBIDDEN_MONEY_TOOLS,
  AiBudgetGuard,
} from "./enforcement.js";

describe("Enforcement del Customer Agent — propose-only (garantía estructural)", () => {
  it("permite tools de lectura/preparación", () => {
    expect(assertToolAllowed("buscar_producto").ok).toBe(true);
    expect(assertToolAllowed("armar_carrito").ok).toBe(true);
  });

  it("PROHIBE toda tool de dinero", () => {
    for (const t of FORBIDDEN_MONEY_TOOLS) {
      const r = assertToolAllowed(t);
      expect(r.ok).toBe(false);
    }
  });

  it("rechaza tools desconocidas (falla cerrado)", () => {
    expect(assertToolAllowed("hackear").ok).toBe(false);
  });

  it("el registro del agente NO contiene ninguna tool de dinero", () => {
    const ids = new Set(CUSTOMER_AGENT_TOOLS.map((t) => t.id));
    for (const forbidden of FORBIDDEN_MONEY_TOOLS) {
      expect(ids.has(forbidden)).toBe(false);
    }
    // y ninguna tool del registro es de escritura/dinero: solo read|prepare
    expect(CUSTOMER_AGENT_TOOLS.every((t) => t.kind === "read" || t.kind === "prepare")).toBe(true);
  });
});

describe("AiBudgetGuard — presupuesto de IA por tenant (falla cerrado)", () => {
  it("cobra dentro del límite y bloquea al superarlo sin aplicar el gasto", () => {
    const b = new AiBudgetGuard(1000n);
    expect(b.charge(600n).ok).toBe(true);
    expect(b.spentMinor).toBe(600n);
    const over = b.charge(600n); // 600+600 > 1000
    expect(over.ok).toBe(false);
    expect(b.spentMinor).toBe(600n); // no se aplicó
  });

  it("límite 0 bloquea cualquier gasto", () => {
    const b = new AiBudgetGuard(0n);
    expect(b.charge(1n).ok).toBe(false);
  });
});
