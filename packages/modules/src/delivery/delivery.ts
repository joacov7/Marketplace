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

// ── Mínimo de pedido por segmento (con alimento vs almacén puro) ─────────────────────
// El cliente de alimento (el ancla) llega al mínimo con una bolsa; el de almacén necesita
// muchos items, así que su mínimo se pone más alto para que la entrega valga la pena. Ambos
// mínimos son config por tenant (delivery.minOrderMinor / delivery.minOrderNoFoodMinor), nunca
// hardcodeados. Un mínimo en 0 = sin mínimo (no bloquea).

export interface MinOrderConfig {
  /** Mínimo cuando el carrito lleva alimento (ancla), en centavos. 0 = sin mínimo. */
  minOrderMinor: bigint;
  /** Mínimo cuando el carrito NO lleva alimento (almacén puro), en centavos. 0 = sin mínimo. */
  minOrderNoFoodMinor: bigint;
}

export interface MinOrderResult {
  /** El carrito incluye alimento (kcal_per_kg > 0). */
  hasFood: boolean;
  /** Mínimo aplicable al carrito, en centavos (según lleve o no alimento). */
  minMinor: bigint;
  /** true = el subtotal alcanza el mínimo (o no hay mínimo). */
  meets: boolean;
  /** Cuánto falta para el mínimo, en centavos (0 si ya alcanza). */
  missingMinor: bigint;
}

/** Lee la config del mínimo por segmento del tenant (resolución platform→tenant). */
export async function resolveMinOrderConfig(db: Db, tenantId: string): Promise<MinOrderConfig> {
  const chain = { tenantId };
  const [withFood, noFood] = await Promise.all([
    resolveConfigValue<number>(db, "delivery.minOrderMinor", chain).then((r) => BigInt(r.value)),
    resolveConfigValue<number>(db, "delivery.minOrderNoFoodMinor", chain).then((r) => BigInt(r.value)),
  ]);
  return { minOrderMinor: withFood, minOrderNoFoodMinor: noFood };
}

/**
 * ¿El carrito incluye al menos un producto de alimento? Alimento = producto con kcal_per_kg > 0
 * (la misma señal que usa la calculadora de consumo). Es el ancla que define qué mínimo rige.
 * Corre bajo el contexto de tenant (RLS).
 */
export async function cartHasFood(db: Db, variantIds: string[]): Promise<boolean> {
  if (variantIds.length === 0) return false;
  const rows = await db.query<{ n: number }>(
    `select 1 as n from variants v
       join products p on p.id = v.product_id
      where v.id = any($1::uuid[]) and coalesce(p.kcal_per_kg, 0) > 0
      limit 1`,
    [variantIds],
  );
  return rows.length > 0;
}

/**
 * Mínimo aplicable por segmento: con alimento rige el mínimo base; sin alimento (almacén puro)
 * rige el mínimo más alto. Un mínimo en 0 = sin mínimo (siempre `meets`). PURO: no toca DB.
 */
export function applyMinOrder(input: { hasFood: boolean; gmvMinor: bigint; config: MinOrderConfig }): MinOrderResult {
  const minMinor = input.hasFood ? input.config.minOrderMinor : input.config.minOrderNoFoodMinor;
  const meets = minMinor <= 0n || input.gmvMinor >= minMinor;
  const missingMinor = meets ? 0n : minMinor - input.gmvMinor;
  return { hasFood: input.hasFood, minMinor, meets, missingMinor };
}

// ── Radio de reparto (geocerca): límite de distancia desde el punto del comercio ─────
// Complementa a las zonas por barrio: las zonas fijan el costo del envío por nombre de
// barrio; el radio es una geocerca dura sobre la ubicación (GPS) que compartió el cliente.
// Todo configurable por tenant (delivery.radiusKm / centerLat / centerLng), nunca hardcodeado.

/** Distancia en km entre dos puntos (lat/lng en grados) por la fórmula de Haversine. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371; // radio terrestre medio (km)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface RadiusConfig {
  /** Filtro activo (radiusKm > 0 y centro configurado). */
  enabled: boolean;
  radiusKm: number;
  centerLat: number;
  centerLng: number;
}

export interface RadiusCheck extends RadiusConfig {
  /** Distancia del punto al centro (km, 1 decimal). null si no se evaluó (sin filtro o sin punto). */
  distanceKm: number | null;
  /** true = se puede entregar. Si el filtro está desactivado o no hay punto, no bloquea (true). */
  withinRadius: boolean;
}

/** Lee la config de radio de reparto del tenant (resolución platform→tenant). */
export async function resolveRadiusConfig(db: Db, tenantId: string): Promise<RadiusConfig> {
  const chain = { tenantId };
  const [radiusKm, centerLat, centerLng] = await Promise.all([
    resolveConfigValue<number>(db, "delivery.radiusKm", chain).then((r) => Number(r.value) || 0),
    resolveConfigValue<number>(db, "delivery.centerLat", chain).then((r) => Number(r.value) || 0),
    resolveConfigValue<number>(db, "delivery.centerLng", chain).then((r) => Number(r.value) || 0),
  ]);
  // Sin centro válido (0,0) el radio no puede evaluarse aunque radiusKm > 0.
  const enabled = radiusKm > 0 && (centerLat !== 0 || centerLng !== 0);
  return { enabled, radiusKm, centerLat, centerLng };
}

/** Evalúa si un punto (lat/lng) cae dentro del radio de reparto del tenant. */
export async function checkDeliveryRadius(
  db: Db,
  input: { tenantId: string; lat?: number | null; lng?: number | null },
): Promise<RadiusCheck> {
  const cfg = await resolveRadiusConfig(db, input.tenantId);
  const hasPoint =
    typeof input.lat === "number" && Number.isFinite(input.lat) &&
    typeof input.lng === "number" && Number.isFinite(input.lng);
  // Sin filtro o sin punto que evaluar: no bloqueamos (el radio es opt-in y la ubicación opcional).
  if (!cfg.enabled || !hasPoint) return { ...cfg, distanceKm: null, withinRadius: true };
  const dist = haversineKm(cfg.centerLat, cfg.centerLng, input.lat as number, input.lng as number);
  return { ...cfg, distanceKm: Math.round(dist * 10) / 10, withinRadius: dist <= cfg.radiusKm };
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
