import { createHmac, timingSafeEqual } from "node:crypto";
import { type Money, type TenantContext, type Result, ok, err } from "@commerce/contracts";
import type { TenantAwareDb } from "@commerce/platform";
import { capturePayment, flagLatePayment } from "./payments.js";
import type { PaymentHandle, PaymentIntent, PaymentProvider, WebhookEvent } from "./provider.js";

/**
 * Mercado Pago — Checkout Pro (redirect). Es la primera implementación real del
 * `PaymentProvider`: el dominio no conoce MP.
 *
 * Por qué Checkout Pro: el cliente paga en la página de MP (tarjeta, débito, dinero en cuenta,
 * cuotas) → no manejamos datos de tarjeta (sin PCI), y sirve igual en celular y compu.
 *
 * Fuente de verdad del cobro: la API de MP consultada con el token del comercio. El webhook
 * solo AVISA ("pasó algo con el pago X"); nunca se confirma un pedido por lo que dice el body
 * del webhook, sino por `GET /v1/payments/{id}`. Así un webhook falsificado no puede marcar
 * nada como pagado (la firma es una capa extra, no la única).
 */

const API = "https://api.mercadopago.com";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface MercadoPagoOptions {
  accessToken: string;
  /** URL a la que MP avisa los cambios del pago (nuestro webhook, con el tenant). */
  notificationUrl?: string;
  /** A dónde vuelve el cliente después de pagar (o de abandonar). */
  backUrls?: { success: string; pending: string; failure: string };
  /** Título del ítem que ve el cliente en MP (p. ej. "Pedido Pet Shop Gualeguay"). */
  title?: string;
  /** Texto en el resumen de la tarjeta (MP lo recorta a 22 caracteres). */
  statementDescriptor?: string;
  /** Vencimiento de la preferencia: después no se puede pagar (alineado al TTL de la reserva). */
  expiresInSeconds?: number;
  /** Inyectable para tests. Por defecto, el fetch global. */
  fetch?: FetchLike;
  /** Inyectable para tests (fecha de vencimiento determinista). */
  now?: () => Date;
  /** Base de la API (default api.mercadopago.com). Solo para pruebas locales contra un simulador. */
  apiBase?: string;
}

/** Estado del pago según MP (subset que usamos). */
export type MpPaymentStatus =
  | "approved"
  | "pending"
  | "authorized"
  | "in_process"
  | "in_mediation"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

export interface MpPayment {
  id: string;
  status: MpPaymentStatus;
  statusDetail: string | null;
  externalReference: string | null;
  amountMinor: bigint;
  currency: string;
  liveMode: boolean;
}

/** Pesos con decimales (MP) ↔ centavos (nuestro modelo, nunca float para guardar). */
export function minorToMpAmount(minor: bigint): number {
  return Number(minor) / 100;
}
export function mpAmountToMinor(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = "mercadopago";
  private readonly fetchFn: FetchLike;

  constructor(private readonly opts: MercadoPagoOptions) {
    if (!opts.accessToken) throw new Error("mp_missing_access_token");
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.accessToken}`,
      "content-type": "application/json",
    };
    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    const res = await this.fetchFn(`${this.opts.apiBase ?? API}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string; error?: string };
        detail = j.message ?? j.error ?? "";
      } catch {
        /* sin body */
      }
      throw new MercadoPagoError(`mp_http_${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    return (await res.json()) as T;
  }

  /**
   * Crea la PREFERENCIA de Checkout Pro. `providerRef` = nuestra referencia (external_reference =
   * orderId): es lo que vuelve en cada pago y con lo que encontramos el `payments` local.
   * `redirectUrl` = init_point, a donde mandamos al cliente.
   */
  async createPayment(_ctx: TenantContext, intent: PaymentIntent): Promise<PaymentHandle> {
    const now = this.opts.now?.() ?? new Date();
    const body: Record<string, unknown> = {
      items: [
        {
          id: intent.orderId,
          title: this.opts.title ?? "Pedido",
          quantity: 1,
          unit_price: minorToMpAmount(intent.amount.amountMinor),
          currency_id: intent.amount.currency,
        },
      ],
      external_reference: intent.orderId,
      metadata: { order_id: intent.orderId },
      // Efectivo (Rapipago/Pago Fácil) y cajero se acreditan días después: para entregas en el
      // día no sirven y dejarían el stock retenido. Solo medios de acreditación inmediata.
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
    };
    if (this.opts.notificationUrl) body.notification_url = this.opts.notificationUrl;
    if (this.opts.backUrls) {
      body.back_urls = this.opts.backUrls;
      body.auto_return = "approved";
    }
    if (this.opts.statementDescriptor) body.statement_descriptor = this.opts.statementDescriptor.slice(0, 22);
    if (this.opts.expiresInSeconds) {
      body.expires = true;
      body.expiration_date_from = now.toISOString();
      body.expiration_date_to = new Date(now.getTime() + this.opts.expiresInSeconds * 1000).toISOString();
    }

    const pref = await this.call<{ id: string; init_point: string }>(
      "POST",
      "/checkout/preferences",
      body,
      intent.idempotencyKey,
    );
    return { providerRef: intent.orderId, redirectUrl: pref.init_point };
  }

  /** Consulta el pago en MP (fuente de verdad). */
  async getPayment(paymentId: string): Promise<MpPayment> {
    const p = await this.call<{
      id: number | string;
      status: MpPaymentStatus;
      status_detail?: string;
      external_reference?: string | null;
      transaction_amount: number;
      currency_id: string;
      live_mode?: boolean;
    }>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);
    return {
      id: String(p.id),
      status: p.status,
      statusDetail: p.status_detail ?? null,
      externalReference: p.external_reference ?? null,
      amountMinor: mpAmountToMinor(p.transaction_amount),
      currency: p.currency_id,
      liveMode: p.live_mode ?? false,
    };
  }

  /** Datos de la cuenta dueña del token (para validar credenciales al guardarlas). */
  async whoAmI(): Promise<{ id: string; nickname: string | null }> {
    const me = await this.call<{ id: number | string; nickname?: string }>("GET", "/users/me");
    return { id: String(me.id), nickname: me.nickname ?? null };
  }

  /** El webhook de MP no se resuelve solo con el body: ver `parseMercadoPagoNotification`. */
  verifyWebhook(): WebhookEvent | null {
    return null;
  }

  /** Reembolso (total si no se indica monto). `providerRef` acá es el id del pago en MP. */
  async refund(_ctx: TenantContext, providerPaymentId: string, amount: Money): Promise<{ ok: boolean }> {
    await this.call(
      "POST",
      `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      { amount: minorToMpAmount(amount.amountMinor) },
      `refund-${providerPaymentId}-${amount.amountMinor}`,
    );
    return { ok: true };
  }
}

// ── Webhooks ───────────────────────────────────────────────────────────────────────

/**
 * Extrae de la notificación de MP el id del pago a consultar. MP manda `?data.id=…&type=payment`
 * en la URL y `{ type, action, data: { id } }` en el body. Otros tópicos (merchant_order, etc.)
 * → null (se responde 200 y se ignoran).
 */
export function parseMercadoPagoNotification(input: {
  query: URLSearchParams;
  body: unknown;
}): { paymentId: string } | null {
  const b = (input.body ?? {}) as { type?: string; topic?: string; data?: { id?: string | number } };
  const type = input.query.get("type") ?? input.query.get("topic") ?? b.type ?? b.topic ?? null;
  if (type !== "payment") return null;
  const id = input.query.get("data.id") ?? input.query.get("id") ?? (b.data?.id != null ? String(b.data.id) : null);
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { paymentId: id };
}

/**
 * Valida la firma `x-signature` de MP ("ts=…,v1=…"): HMAC-SHA256 con la clave secreta de
 * webhooks del comercio sobre el manifiesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 * Comparación en tiempo constante. `maxAgeSeconds` acota el replay.
 */
export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string;
  secret: string;
  nowMs?: number;
  maxAgeSeconds?: number;
}): boolean {
  if (!input.signatureHeader || !input.secret) return false;
  const parts = Object.fromEntries(
    input.signatureHeader.split(",").map((kv) => {
      const [k, ...v] = kv.trim().split("=");
      return [k ?? "", v.join("=")];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;

  if (input.maxAgeSeconds) {
    const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
    const now = input.nowMs ?? Date.now();
    if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > input.maxAgeSeconds * 1000) return false;
  }

  const id = /^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  let manifest = `id:${id};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Aplicar el estado de un pago de MP a nuestro modelo ─────────────────────────────

export type MpApplyOutcome =
  | { kind: "captured"; paymentId: string; stockShortfall?: string[] }
  | { kind: "already_captured" }
  /** Aprobado DESPUÉS de que el pedido se canceló por abandono: hay que reembolsarlo. */
  | { kind: "late_payment"; mpPaymentId: string; orderId: string }
  | { kind: "ignored"; status: MpPaymentStatus }
  | { kind: "unknown_reference" };

/**
 * Aplica un pago de MP (ya consultado a la API con el token del comercio) a nuestro modelo.
 * Lo usan el webhook y la verificación al volver del checkout (el que llegue primero gana;
 * el otro es no-op por idempotencia).
 *  - approved → capturePayment (ledger + confirma pedido), con control de monto.
 *  - cualquier otro estado → no se toca nada (rechazado: el cliente puede reintentar en MP
 *    mientras la preferencia esté vigente; si no paga, la reserva vence sola).
 */
export async function applyMercadoPagoPayment(
  db: TenantAwareDb,
  input: { tenantId: string; payment: MpPayment },
): Promise<Result<MpApplyOutcome, string>> {
  const p = input.payment;
  if (!p.externalReference) return ok({ kind: "unknown_reference" });
  if (p.status !== "approved") return ok({ kind: "ignored", status: p.status });

  const res = await capturePayment(db, {
    tenantId: input.tenantId,
    providerEventId: `mercadopago:${p.id}:approved`,
    providerRef: p.externalReference,
    paidAmountMinor: p.amountMinor,
    providerPaymentId: p.id,
  });
  if (res.ok) {
    if (res.value.alreadyProcessed) return ok({ kind: "already_captured" });
    return ok({ kind: "captured", paymentId: res.value.paymentId, ...(res.value.stockShortfall ? { stockShortfall: res.value.stockShortfall } : {}) });
  }
  if (res.error === "payment_not_found") return ok({ kind: "unknown_reference" });
  if (res.error === "payment_not_pending:failed") {
    await flagLatePayment(db, { tenantId: input.tenantId, providerRef: p.externalReference, providerPaymentId: p.id });
    return ok({ kind: "late_payment", mpPaymentId: p.id, orderId: p.externalReference });
  }
  if (res.error.startsWith("payment_not_pending:")) return ok({ kind: "already_captured" });
  return err(res.error);
}
