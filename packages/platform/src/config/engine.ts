import {
  CONFIG_SCOPE_ORDER,
  type ConfigScopeType,
  type ConfigValue,
  type ConfigScopeChain,
} from "@commerce/contracts";

/** Devuelve el scopeId que aplica para un scopeType dado la cadena de la operación. */
export function scopeIdFor(
  chain: ConfigScopeChain,
  scopeType: ConfigScopeType,
): string | undefined {
  switch (scopeType) {
    case "platform":
      return "platform";
    case "tenant":
      return chain.tenantId;
    case "region":
      return chain.regionId;
    case "merchant":
      return chain.merchantId;
    case "user":
      return chain.userId;
  }
}

const specificity = (s: ConfigScopeType): number => CONFIG_SCOPE_ORDER.indexOf(s);

export interface ResolveResult<V> {
  value: V;
  /** De dónde salió el valor efectivo. */
  source: ConfigScopeType | "default";
  version?: number;
}

/**
 * Resuelve el valor efectivo de una clave (decisión C1/D8). Reglas:
 *  - Solo cuentan los valores cuyo scopeId coincide con la cadena de la operación.
 *  - Solo cuentan los vigentes: `effectiveFrom <= at` (effective-dating: un valor futuro
 *    no afecta operaciones actuales, y un cambio de comisión no toca pedidos en curso).
 *  - Gana el scope MÁS ESPECÍFICO (user > merchant > region > tenant > platform).
 *  - A igual scope, gana la MAYOR version.
 *  - Si no hay ninguno aplicable, cae al `defaultValue`.
 */
export function resolveConfig<V>(opts: {
  key: string;
  values: readonly ConfigValue[];
  chain: ConfigScopeChain;
  defaultValue: V;
  at?: Date;
}): ResolveResult<V> {
  const at = opts.at ?? new Date();

  const candidates = opts.values.filter((v) => {
    if (v.key !== opts.key) return false;
    if (new Date(v.effectiveFrom).getTime() > at.getTime()) return false;
    const expectedId = scopeIdFor(opts.chain, v.scopeType);
    return expectedId !== undefined && expectedId === v.scopeId;
  });

  if (candidates.length === 0) {
    return { value: opts.defaultValue, source: "default" };
  }

  candidates.sort((a, b) => {
    const bySpec = specificity(b.scopeType) - specificity(a.scopeType);
    if (bySpec !== 0) return bySpec;
    return b.version - a.version;
  });

  const winner = candidates[0]!;
  return {
    value: winner.value as V,
    source: winner.scopeType,
    version: winner.version,
  };
}
