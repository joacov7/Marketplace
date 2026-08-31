import { describe, it, expect } from "vitest";
import { money, zero, add, subtract, sum, percentageOfBps, allocate, equals } from "./money.js";

describe("Money — aritmética en centavos (sin float)", () => {
  it("suma y resta sin pérdida", () => {
    expect(add(money(1999, "ARS"), money(1, "ARS")).amountMinor).toBe(2000n);
    expect(subtract(money(3_000_000, "ARS"), money(1_500_000, "ARS")).amountMinor).toBe(1_500_000n);
  });

  it("rechaza monedas distintas", () => {
    expect(() => add(money(1, "ARS"), money(1, "USD"))).toThrow(/currency mismatch/);
  });

  it("sum de una lista", () => {
    const total = sum([money(100, "ARS"), money(250, "ARS"), money(50, "ARS")], "ARS");
    expect(total.amountMinor).toBe(400n);
  });

  it("percentageOfBps: 7% de $30.000 = $2.100", () => {
    // $30.000 = 3.000.000 centavos; 7% = 700 bps → 210.000 centavos = $2.100
    expect(percentageOfBps(money(3_000_000, "ARS"), 700n).amountMinor).toBe(210_000n);
  });
});

describe("Money.allocate — reparto sin perder centavos (PaymentAllocation)", () => {
  it("la suma de las partes es EXACTAMENTE el total (caso con remanente)", () => {
    // 100 centavos en 3 partes iguales: 34 + 33 + 33 = 100 (no 33.33 c/u)
    const parts = allocate(money(100, "ARS"), [1n, 1n, 1n]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0n)).toBe(100n);
  });

  it("reparto ponderado comercio/comisión/delivery también cierra exacto", () => {
    // total $32.500 = 3.250.000 c; pesos: comercio 90, comisión 7, delivery 3
    const total = money(3_250_000, "ARS");
    const parts = allocate(total, [90n, 7n, 3n]);
    expect(parts.reduce((a, p) => a + p.amountMinor, 0n)).toBe(total.amountMinor);
  });

  it("un total indivisible reparte el remanente de forma determinista (peso mayor primero)", () => {
    const parts = allocate(money(10, "ARS"), [2n, 1n]); // exact: 6.66/3.33 → 7 + 3
    expect(parts.map((p) => p.amountMinor)).toEqual([7n, 3n]);
  });

  it("maneja total 0", () => {
    const parts = allocate(zero("ARS"), [1n, 1n]);
    expect(parts.every((p) => equals(p, zero("ARS")))).toBe(true);
  });
});
