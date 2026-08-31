import type { Money, CurrencyCode } from "@commerce/contracts";

/**
 * Aritmética de dinero sobre enteros (centavos) — nunca float (D7). Incluye `allocate`,
 * clave para PaymentAllocation: reparte un total entre partes sin perder ni inventar
 * centavos (la suma de las partes es EXACTAMENTE el total).
 */

export function money(amountMinor: bigint | number, currency: CurrencyCode): Money {
  return { amountMinor: BigInt(amountMinor), currency };
}

export function zero(currency: CurrencyCode): Money {
  return { amountMinor: 0n, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Money: currency mismatch ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, m) => add(acc, m), zero(currency));
}

export function isNegative(m: Money): boolean {
  return m.amountMinor < 0n;
}

export function isZero(m: Money): boolean {
  return m.amountMinor === 0n;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/**
 * Porcentaje en puntos básicos (basis points): 1% = 100 bps, 7% = 700 bps. Entero, con
 * truncado hacia abajo. Para comisiones/fees sobre un monto.
 */
export function percentageOfBps(m: Money, bps: bigint): Money {
  return { amountMinor: (m.amountMinor * bps) / 10_000n, currency: m.currency };
}

/**
 * Reparte `total` en partes proporcionales a `weights` (enteros), garantizando que la
 * suma de las partes es exactamente el total. El remanente de centavos se distribuye de
 * a uno, empezando por los pesos mayores (determinista) — evita el clásico bug de
 * "falta/sobra un centavo" en splits de pago.
 */
export function allocate(total: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new Error("allocate: weights vacío");
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight <= 0n) throw new Error("allocate: la suma de weights debe ser > 0");

  const shares = weights.map((w) => (total.amountMinor * w) / totalWeight);
  let remainder = total.amountMinor - shares.reduce((a, b) => a + b, 0n);

  // orden determinista: peso descendente, y a igualdad, índice ascendente.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (b.w > a.w ? 1 : b.w < a.w ? -1 : a.i - b.i));

  let k = 0;
  const step = remainder >= 0n ? 1n : -1n;
  while (remainder !== 0n) {
    const idx = order[k % order.length]!.i;
    shares[idx] = shares[idx]! + step;
    remainder -= step;
    k++;
  }

  return shares.map((amountMinor) => ({ amountMinor, currency: total.currency }));
}
