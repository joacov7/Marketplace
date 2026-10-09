import { headers } from "next/headers";
import { loadMpCredentials, isMpEnabled, MercadoPagoProvider, type MpCredentials, type MercadoPagoOptions } from "@commerce/modules/payments";
import { db } from "./db";

/**
 * Pegamento de Mercado Pago para la app: clave de cifrado de plataforma, URL pública del
 * deploy y credenciales del comercio. La lógica de cobro vive en @commerce/modules/payments.
 */

/** Cuánto tiempo tiene el cliente para pagar: reserva de stock y vencimiento de la preferencia. */
export const MP_PAY_WINDOW_SECONDS = 30 * 60;

/** Clave de cifrado de los tokens (env var de plataforma). null si no está configurada. */
export function paymentsEncryptionKey(): string | null {
  const k = process.env.PAYMENTS_ENCRYPTION_KEY;
  return k && k.length >= 32 ? k : null;
}

/** Origen público del deploy (para back_urls y notification_url). */
export function publicOrigin(req: Request): string {
  const fromEnv = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** El comercio (V1: uno por tenant) de un tenant. */
export async function mainMerchantId(tenantId: string): Promise<string | null> {
  const rows = await db().withTenant(tenantId, (tx) =>
    tx.query<{ id: string }>("select id from merchants order by created_at limit 1"),
  );
  return rows[0]?.id ?? null;
}

/** ¿Se puede ofrecer "Pagar ahora" en la tienda? (credenciales activas + clave de cifrado). */
export async function mercadoPagoAvailable(tenantId: string, merchantId: string): Promise<boolean> {
  if (!paymentsEncryptionKey()) return false;
  return db().withTenant(tenantId, (tx) => isMpEnabled(tx, merchantId));
}

/**
 * Credenciales descifradas del comercio (solo server). null si no hay, falta la clave o no se
 * pueden descifrar (p. ej. se cambió PAYMENTS_ENCRYPTION_KEY: hay que reconectar MP).
 */
export async function mercadoPagoCredentials(tenantId: string, merchantId: string): Promise<MpCredentials | null> {
  const key = paymentsEncryptionKey();
  if (!key) return null;
  try {
    return await db().withTenant(tenantId, (tx) => loadMpCredentials(tx, merchantId, key));
  } catch (e) {
    console.error(`[mercadopago] no se pudieron leer las credenciales (tenant=${tenantId}): ${String(e)}`);
    return null;
  }
}

/**
 * Simulador de MP para pruebas locales (`MERCADOPAGO_API_BASE`). Ignorado en producción:
 * ahí siempre se habla con api.mercadopago.com.
 */
export function mpApiBase(): { apiBase?: string } {
  const base = process.env.MERCADOPAGO_API_BASE;
  return base && process.env.NODE_ENV !== "production" ? { apiBase: base } : {};
}

export function mercadoPagoProvider(creds: MpCredentials, opts: Omit<MercadoPagoOptions, "accessToken"> = {}): MercadoPagoProvider {
  return new MercadoPagoProvider({ accessToken: creds.accessToken, ...mpApiBase(), ...opts });
}

/** URL que MP llama con cada novedad del pago (por comercio, con el tenant para resolver RLS). */
export function webhookUrl(origin: string, merchantId: string, tenantSlug: string): string {
  return `${origin}/api/webhooks/payments/${merchantId}?tenant=${encodeURIComponent(tenantSlug)}&source_news=webhooks`;
}
