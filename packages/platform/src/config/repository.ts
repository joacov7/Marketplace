import type { ConfigScopeChain, ConfigScopeType, ConfigValue } from "@commerce/contracts";
import { type Result, ok, err } from "@commerce/contracts";
import type { Db } from "../db/port.js";
import { resolveConfig, type ResolveResult } from "./engine.js";
import { getConfigKeyDef } from "./registry.js";
import { validateConfigValue } from "./validate.js";

/**
 * Escribe un valor de config. Valida contra el JSON Schema de la clave (config tipada),
 * calcula la próxima versión para ese (key, scope) y lo inserta con auditoría (actor +
 * reason) y effective-dating. Las claves de dinero/reglas exigen `reason` (sensibles).
 */
export async function setConfigValue(
  db: Db,
  input: {
    key: string;
    scopeType: ConfigScopeType;
    scopeId: string;
    value: unknown;
    actor: string;
    reason?: string;
    effectiveFrom?: Date;
  },
): Promise<Result<{ version: number }, string>> {
  const def = getConfigKeyDef(input.key);
  if (!def) return err(`config key desconocida: ${input.key}`);

  const valid = validateConfigValue(def.jsonSchema, input.value);
  if (!valid.ok) return err(`valor inválido para ${input.key}: ${valid.error.join("; ")}`);

  if (def.sensitive && !input.reason) {
    return err(`la clave sensible ${input.key} requiere 'reason' para auditoría`);
  }

  const [prev] = await db.query<{ max: number | null }>(
    `select max(version) as max from config_values where key = $1 and scope_type = $2 and scope_id = $3`,
    [input.key, input.scopeType, input.scopeId],
  );
  const version = (prev?.max ?? 0) + 1;

  await db.query(
    `insert into config_values (key, scope_type, scope_id, value, version, effective_from, actor, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.key,
      input.scopeType,
      input.scopeId,
      JSON.stringify(input.value),
      version,
      (input.effectiveFrom ?? new Date()).toISOString(),
      input.actor,
      input.reason ?? null,
    ],
  );
  return ok({ version });
}

/** Pares (scope_type, scope_id) que aplican a una cadena, para acotar la query. */
function scopePairs(chain: ConfigScopeChain): Array<[ConfigScopeType, string]> {
  const pairs: Array<[ConfigScopeType, string]> = [["platform", "platform"], ["tenant", chain.tenantId]];
  if (chain.regionId) pairs.push(["region", chain.regionId]);
  if (chain.merchantId) pairs.push(["merchant", chain.merchantId]);
  if (chain.userId) pairs.push(["user", chain.userId]);
  return pairs;
}

/**
 * Resuelve el valor efectivo de una clave: carga los candidatos de los scopes que aplican
 * y delega en el resolver puro (precedencia + effective-dating + versión). Cae al default
 * del registro si no hay ninguno.
 */
export async function resolveConfigValue<V>(
  db: Db,
  key: string,
  chain: ConfigScopeChain,
  at?: Date,
): Promise<ResolveResult<V>> {
  const def = getConfigKeyDef(key);
  const pairs = scopePairs(chain);
  const conds = pairs.map((_, i) => `(scope_type = $${i * 2 + 2} and scope_id = $${i * 2 + 3})`).join(" or ");
  const params: unknown[] = [key];
  for (const [t, id] of pairs) params.push(t, id);

  const rows = await db.query<{
    key: string;
    scope_type: ConfigScopeType;
    scope_id: string;
    value: V;
    version: number;
    effective_from: string;
    actor: string;
    reason: string | null;
  }>(`select key, scope_type, scope_id, value, version, effective_from, actor, reason
      from config_values where key = $1 and (${conds})`, params);

  const values: ConfigValue[] = rows.map((r) => ({
    key: r.key,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    value: r.value,
    version: r.version,
    effectiveFrom: new Date(r.effective_from).toISOString(),
    actor: r.actor,
    ...(r.reason !== null ? { reason: r.reason } : {}),
  }));

  return resolveConfig<V>({
    key,
    values,
    chain,
    defaultValue: (def?.defaultValue as V),
    ...(at ? { at } : {}),
  });
}
