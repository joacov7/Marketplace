import { type Db, type TenantAwareDb, resolveConfigValue, enqueueEvent } from "@commerce/platform";
import { type Result, ok, err } from "@commerce/contracts";
import { canTransitionDelivery, type DeliveryStatus } from "./state.js";

export type SubsidySource = "platform" | "merchant" | "promo" | "none";

export interface DeliveryQuote {
  cadeteCostMinor: bigint;
  customerChargeMinor: bigint;
  subsidySource: SubsidySource;
  /** Gap financiado (cadete − cliente); >0 = hay subsidio. */
  subsidyMinor: bigint;
}

/**
 * Cotiza una entrega. Prioridad: tarifa por zona (delivery_rates) si existe; si no,
 * defaults de config. El cargo al cliente es gratis sobre el umbral de ticket
 * (delivery.freeOverOrderTotalMinor). "No se regala delivery sin fuente de financiación":
 * el gap tiene `subsidySource` explícito (sección 7 del doc).
 */
export async function quoteDelivery(
  db: Db,
  input: { tenantId: string; orderTotalMinor: bigint; zoneId?: string },
): Promise<DeliveryQuote> {
  const chain = { tenantId: input.tenantId };
  let cadeteCostMinor: bigint;
  let baseCustomerCharge: bigint;
  let subsidySource: SubsidySource;

  const rateRows = input.zoneId
    ? await db.query<{ cadete_cost_minor: string; customer_charge_minor: string; subsidy_source: SubsidySource }>(
        `select cadete_cost_minor, customer_charge_minor, subsidy_source from delivery_rates where zone_id = $1 limit 1`,
        [input.zoneId],
      )
    : [];

  if (rateRows[0]) {
    cadeteCostMinor = BigInt(rateRows[0].cadete_cost_minor);
    baseCustomerCharge = BigInt(rateRows[0].customer_charge_minor);
    subsidySource = rateRows[0].subsidy_source;
  } else {
    cadeteCostMinor = BigInt((await resolveConfigValue<number>(db, "delivery.cadeteCostMinor", chain)).value);
    baseCustomerCharge = BigInt((await resolveConfigValue<number>(db, "delivery.customerChargeMinor", chain)).value);
    subsidySource = (await resolveConfigValue<SubsidySource>(db, "delivery.subsidySource", chain)).value;
  }

  const freeOver = BigInt((await resolveConfigValue<number>(db, "delivery.freeOverOrderTotalMinor", chain)).value);
  const customerChargeMinor = input.orderTotalMinor >= freeOver ? 0n : baseCustomerCharge;
  const subsidyMinor = cadeteCostMinor - customerChargeMinor > 0n ? cadeteCostMinor - customerChargeMinor : 0n;

  return { cadeteCostMinor, customerChargeMinor, subsidySource, subsidyMinor };
}

// ── Zonas de reparto (Eslabón 3): costo y tiempo por barrio ─────────────────────────
// Reusa delivery_zones (nombre + eta) + delivery_rates (tarifa al cliente). El costo por
// zona reemplaza al envío plano en el checkout cuando la zona matchea. Todo bajo RLS/tenant.

export interface Zone {
  id: string;
  name: string;
  customerChargeMinor: bigint;
  etaMinutes: number | null;
}
interface ZoneRow {
  id: string;
  name: string;
  customer_charge_minor: string | null;
  eta_minutes: number | null;
}
const mapZone = (r: ZoneRow): Zone => ({
  id: r.id,
  name: r.name,
  customerChargeMinor: BigInt(r.customer_charge_minor ?? "0"),
  etaMinutes: r.eta_minutes,
});

export async function listZones(db: Db): Promise<Zone[]> {
  const rows = await db.query<ZoneRow>(
    `select z.id, z.name, z.eta_minutes,
            (select r.customer_charge_minor from delivery_rates r where r.zone_id = z.id limit 1) as customer_charge_minor
       from delivery_zones z order by z.name`,
  );
  return rows.map(mapZone);
};

/** Crea una zona + su tarifa. El costo del cadete = cargo al cliente (sin subsidio) por defecto. */
export async function createZone(
  db: Db,
  input: { tenantId: string; name: string; customerChargeMinor: bigint; etaMinutes?: number },
): Promise<{ id: string }> {
  const [z] = await db.query<{ id: string }>(
    `insert into delivery_zones (tenant_id, name, eta_minutes) values ($1,$2,$3) returning id`,
    [input.tenantId, input.name, input.etaMinutes ?? null],
  );
  await db.query(
    `insert into delivery_rates (tenant_id, zone_id, cadete_cost_minor, customer_charge_minor, subsidy_source)
     values ($1,$2,$3,$3,'none')`,
    [input.tenantId, z!.id, input.customerChargeMinor.toString()],
  );
  return { id: z!.id };
}

export async function updateZone(
  db: Db,
  input: { id: string; name?: string; customerChargeMinor?: bigint; etaMinutes?: number | null },
): Promise<void> {
  if (input.name !== undefined || input.etaMinutes !== undefined) {
    const sets: string[] = [];
    const params: unknown[] = [input.id];
    if (input.name !== undefined) { params.push(input.name); sets.push(`name = $${params.length}`); }
    if (input.etaMinutes !== undefined) { params.push(input.etaMinutes); sets.push(`eta_minutes = $${params.length}`); }
    if (sets.length) await db.query(`update delivery_zones set ${sets.join(", ")} where id = $1`, params);
  }
  if (input.customerChargeMinor !== undefined) {
    await db.query(`update delivery_rates set cadete_cost_minor = $2, customer_charge_minor = $2 where zone_id = $1`, [
      input.id,
      input.customerChargeMinor.toString(),
    ]);
  }
}

export async function deleteZone(db: Db, id: string): Promise<void> {
  await db.query(`delete from delivery_rates where zone_id = $1`, [id]);
  await db.query(`delete from delivery_zones where id = $1`, [id]);
}

/** Busca la tarifa de una zona por nombre (case-insensitive). Null si no hay match. */
export async function zoneChargeByName(
  db: Db,
  name: string,
): Promise<{ zoneId: string; customerChargeMinor: bigint; etaMinutes: number | null } | null> {
  const n = name.trim();
  if (!n) return null;
  const [row] = await db.query<ZoneRow>(
    `select z.id, z.name, z.eta_minutes,
            (select r.customer_charge_minor from delivery_rates r where r.zone_id = z.id limit 1) as customer_charge_minor
       from delivery_zones z where lower(z.name) = lower($1) limit 1`,
    [n],
  );
  if (!row) return null;
  const z = mapZone(row);
  return { zoneId: z.id, customerChargeMinor: z.customerChargeMinor, etaMinutes: z.etaMinutes };
}

/** Crea la entrega de un seller_order (V1: directo comercio→cliente). */
export async function createDelivery(
  db: TenantAwareDb,
  input: { tenantId: string; sellerOrderId: string; orderTotalMinor: bigint; zoneId?: string; etaMinutes?: number },
): Promise<Result<{ deliveryId: string; quote: DeliveryQuote }, string>> {
  try {
    return ok(
      await db.withTenant(input.tenantId, async (tx) => {
        const quote = await quoteDelivery(tx, input);
        const [d] = await tx.query<{ id: string }>(
          `insert into deliveries (tenant_id, seller_order_id, zone_id, status, cadete_cost_minor, customer_charge_minor, subsidy_source, eta_minutes)
           values ($1,$2,$3,'pending',$4,$5,$6,$7) returning id`,
          [
            input.tenantId,
            input.sellerOrderId,
            input.zoneId ?? null,
            quote.cadeteCostMinor.toString(),
            quote.customerChargeMinor.toString(),
            quote.subsidySource,
            input.etaMinutes ?? null,
          ],
        );
        await tx.query(`insert into delivery_events (tenant_id, delivery_id, type) values ($1,$2,'created')`, [
          input.tenantId,
          d!.id,
        ]);
        return { deliveryId: d!.id, quote };
      }),
    );
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** Transiciona la entrega (asignar cadete, retirar, entregar, fallar), registrando evento. */
export async function transitionDelivery(
  db: TenantAwareDb,
  input: { tenantId: string; deliveryId: string; to: DeliveryStatus; driverId?: string; evidence?: unknown },
): Promise<Result<true, string>> {
  try {
    await db.withTenant(input.tenantId, async (tx) => {
      const [row] = await tx.query<{ status: DeliveryStatus }>(`select status from deliveries where id = $1`, [
        input.deliveryId,
      ]);
      if (!row) throw new Error("delivery_not_found");
      if (!canTransitionDelivery(row.status, input.to)) throw new Error(`invalid_transition:${row.status}->${input.to}`);

      await tx.query(
        `update deliveries set status = $2, driver_id = coalesce($3, driver_id), updated_at = now() where id = $1`,
        [input.deliveryId, input.to, input.driverId ?? null],
      );
      await tx.query(`insert into delivery_events (tenant_id, delivery_id, type, data) values ($1,$2,$3,$4)`, [
        input.tenantId,
        input.deliveryId,
        input.to,
        input.evidence !== undefined ? JSON.stringify(input.evidence) : null,
      ]);
      if (input.to === "delivered" || input.to === "failed") {
        await enqueueEvent(tx, {
          tenantId: input.tenantId,
          type: input.to === "delivered" ? "delivery.completed" : "delivery.failed",
          payload: { deliveryId: input.deliveryId },
        });
      }
    });
    return ok(true);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export async function getDelivery(
  db: Db,
  deliveryId: string,
): Promise<{ id: string; status: string; cadeteCostMinor: bigint; customerChargeMinor: bigint; subsidySource: string } | null> {
  const [d] = await db.query<{
    id: string;
    status: string;
    cadete_cost_minor: string;
    customer_charge_minor: string;
    subsidy_source: string;
  }>(`select id, status, cadete_cost_minor, customer_charge_minor, subsidy_source from deliveries where id = $1`, [
    deliveryId,
  ]);
  if (!d) return null;
  return {
    id: d.id,
    status: d.status,
    cadeteCostMinor: BigInt(d.cadete_cost_minor),
    customerChargeMinor: BigInt(d.customer_charge_minor),
    subsidySource: d.subsidy_source,
  };
}
