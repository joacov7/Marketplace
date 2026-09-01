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
