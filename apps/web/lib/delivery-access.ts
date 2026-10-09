import { timingSafeEqual } from "node:crypto";

/**
 * Acceso a la pantalla de reparto (/api/delivery/*): lo abre el código maestro o el PIN de
 * reparto del comercio (`ops.deliveryPin`). Lógica pura (sin Next ni base) para poder probarla.
 *
 * Contra fuerza bruta del PIN:
 *  - El bloqueo se consulta ANTES de validar el PIN: durante el bloqueo ni el PIN correcto
 *    entra. El código maestro sí (no es adivinable y deja al comercio operar durante un ataque).
 *  - Se cuentan los fallos por IP y por comercio (el segundo frena ataques desde muchas IPs),
 *    en un contador COMPARTIDO (Postgres): uno en memoria lo tendría cada ruta/instancia aparte.
 *  - El PIN tiene que tener al menos DELIVERY_PIN_MIN_LENGTH caracteres; uno más corto (cargado
 *    antes de esta regla) no abre: el comercio tiene que definir uno nuevo.
 */
export const DELIVERY_PIN_MIN_LENGTH = 6;
export const DELIVERY_FAILS_PER_IP = 10;
export const DELIVERY_FAILS_PER_TENANT = 50;
export const DELIVERY_LOCK_WINDOW_MS = 15 * 60_000;

function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** ¿Con qué credencial entra? `pin` corto o vacío = el comercio no tiene PIN válido. */
export function deliveryCredential(
  provided: string | null,
  adminToken: string | undefined,
  pin: unknown,
): "admin" | "pin" | "denied" {
  if (!provided) return "denied";
  if (safeEqual(provided, adminToken)) return "admin";
  if (typeof pin === "string" && pin.length >= DELIVERY_PIN_MIN_LENGTH && safeEqual(provided, pin)) return "pin";
  return "denied";
}

export type DeliveryAccess = { ok: true } | { ok: false; status: 401 | 429; retryAfterSec?: number };

/** Dónde se cuentan los fallos (en la app: tabla auth_failures; en tests: memoria). */
export interface FailureStore {
  status(keys: string[]): Promise<Array<{ key: string; count: number; retryAfterMs: number }>>;
  record(keys: string[], windowMs: number): Promise<void>;
}

/**
 * Decide el acceso aplicando el bloqueo por fallos. `loadPin` se llama solo si no hay bloqueo
 * (no tocamos la base durante un ataque).
 */
export async function checkDeliveryAccess(input: {
  tenantId: string;
  ip: string;
  provided: string | null;
  adminToken: string | undefined;
  loadPin: () => Promise<unknown>;
  failures: FailureStore;
}): Promise<DeliveryAccess> {
  // El código maestro (secreto largo, no adivinable) entra siempre: un ataque al PIN que dispare
  // el bloqueo por comercio no puede dejar al comercio sin acceso al reparto.
  if (safeEqual(input.provided, input.adminToken)) return { ok: true };

  const ipKey = `delivery-fail:ip:${input.tenantId}:${input.ip}`;
  const tenantKey = `delivery-fail:tenant:${input.tenantId}`;

  const limits: Record<string, number> = { [ipKey]: DELIVERY_FAILS_PER_IP, [tenantKey]: DELIVERY_FAILS_PER_TENANT };
  const blocked = (await input.failures.status([ipKey, tenantKey])).filter((f) => f.count >= (limits[f.key] ?? Infinity));
  if (blocked.length > 0) {
    const retry = Math.max(...blocked.map((b) => b.retryAfterMs));
    return { ok: false, status: 429, retryAfterSec: Math.max(1, Math.ceil(retry / 1000)) };
  }

  const cred = deliveryCredential(input.provided, input.adminToken, input.provided ? await input.loadPin() : "");
  if (cred !== "denied") return { ok: true };

  await input.failures.record([ipKey, tenantKey], DELIVERY_LOCK_WINDOW_MS);
  return { ok: false, status: 401 };
}
