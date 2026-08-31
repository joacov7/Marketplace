/**
 * Dinero: SIEMPRE en unidad mínima (centavos) como bigint, + código de moneda.
 * Nunca float (decisión D7). El monto es un entero: $30.000,00 ARS = 3_000_000n, "ARS".
 *
 * Este archivo es solo el TIPO. La aritmética segura (suma, resta, reparto sin perder
 * centavos) vive en @commerce/platform/money, porque contracts no lleva lógica.
 */
export type CurrencyCode = "ARS" | "USD";

export interface Money {
  /** Monto en la unidad mínima de la moneda (centavos). Entero. */
  amountMinor: bigint;
  currency: CurrencyCode;
}
