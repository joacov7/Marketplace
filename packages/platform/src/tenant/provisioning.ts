import { type Result, ok, err } from "@commerce/contracts";
import type { TenantAwareDb } from "../db/port.js";
import { setConfigValue } from "../config/repository.js";
import type { VerticalTemplate } from "./templates.js";

export interface CreateTenantInput {
  slug: string;
  name: string;
  template: VerticalTemplate;
  region: { slug: string; name: string };
  actor: string;
  /** Overrides puntuales de config sobre los defaults de la plantilla (opcional). */
  configOverrides?: ReadonlyArray<{ key: string; value: unknown; reason?: string }>;
}

export interface CreateTenantResult {
  tenantId: string;
  regionId: string;
}

/**
 * Crea un tenant + su primera región y aplica una plantilla de vertical, TODO por datos:
 * no hay código específico por tenant/ciudad. Es el flujo White Label (crear tenant →
 * plantilla → branding → … → publicar) reducido a su núcleo (F1). Atómico: si algún
 * valor de la plantilla es inválido, hace rollback completo.
 *
 * La región y el merchant viven bajo RLS, así que dentro de la misma transacción se setea
 * `app.tenant_id` al tenant recién creado antes de insertarlos (la política WITH CHECK
 * los valida contra ese tenant).
 */
export async function createTenant(
  db: TenantAwareDb,
  input: CreateTenantInput,
): Promise<Result<CreateTenantResult, string>> {
  try {
    const result = await db.tx(async (tx) => {
      const [t] = await tx.query<{ id: string }>(
        `insert into tenants (slug, name) values ($1, $2) returning id`,
        [input.slug, input.name],
      );
      const tenantId = t!.id;

      // Contexto de tenant para satisfacer RLS al insertar región/merchant en esta tx.
      await tx.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

      const [r] = await tx.query<{ id: string }>(
        `insert into regions (tenant_id, slug, name) values ($1, $2, $3) returning id`,
        [tenantId, input.region.slug, input.region.name],
      );
      const regionId = r!.id;

      // Sembrar defaults de la plantilla en scope = tenant.
      for (const d of input.template.configDefaults) {
        const res = await setConfigValue(tx, {
          key: d.key,
          scopeType: "tenant",
          scopeId: tenantId,
          value: d.value,
          actor: input.actor,
          reason: `template:${input.template.id}`,
        });
        if (!res.ok) throw new Error(res.error);
      }

      // Vertical + módulos habilitados como config del tenant.
      for (const [key, value] of [
        ["tenant.vertical", input.template.vertical],
        ["modules.enabled", input.template.enabledModules],
      ] as const) {
        const res = await setConfigValue(tx, {
          key,
          scopeType: "tenant",
          scopeId: tenantId,
          value,
          actor: input.actor,
          reason: `template:${input.template.id}`,
        });
        if (!res.ok) throw new Error(res.error);
      }

      // Overrides puntuales (branding/dominio/comisión propios del tenant).
      for (const o of input.configOverrides ?? []) {
        const res = await setConfigValue(tx, {
          key: o.key,
          scopeType: "tenant",
          scopeId: tenantId,
          value: o.value,
          actor: input.actor,
          ...(o.reason ? { reason: o.reason } : { reason: "provision-override" }),
        });
        if (!res.ok) throw new Error(res.error);
      }

      return { tenantId, regionId };
    });
    return ok(result);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
