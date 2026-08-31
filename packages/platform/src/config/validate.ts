import { Ajv } from "ajv";
import type { JsonSchema } from "@commerce/contracts";
import { type Result, ok, err } from "@commerce/contracts";

/**
 * Valida un valor de config contra su JSON Schema al ESCRIBIR (config tipada — C1/D8).
 * Un valor inválido falla al guardarse, no en el checkout de un cliente.
 */
const ajv = new Ajv({ allErrors: true, strict: false });

export function validateConfigValue(schema: JsonSchema, value: unknown): Result<true, string[]> {
  const validate = ajv.compile(schema);
  if (validate(value)) return ok(true);
  const messages = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "inválido"}`,
  );
  return err(messages.length > 0 ? messages : ["valor inválido"]);
}
