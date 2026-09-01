import type { Money, TenantContext } from "@commerce/contracts";

/**
 * Payment Orchestrator: el dominio habla con esta interfaz, NO con Mercado Pago (D5/L2).
 * MP es la primera implementación; incorporar otro PSP no toca el dominio. El reparto
 * multi-seller vive en payment_allocations + ledger, NO en un split plano del PSP.
 */
export interface PaymentIntent {
  orderId: string;
  amount: Money;
  /** Idempotencia del checkout: reintentar con la misma key no crea otro cobro. */
  idempotencyKey: string;
}

export interface PaymentHandle {
  providerRef: string;
  /** Datos para que el cliente complete el pago (brick/redirect). Opaco para el dominio. */
  clientSecret?: string;
}

export interface WebhookEvent {
  providerEventId: string;
  providerRef: string;
  type: "payment.approved" | "payment.rejected" | "payment.refunded";
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(ctx: TenantContext, intent: PaymentIntent): Promise<PaymentHandle>;
  /** Verifica firma + parsea un webhook. Devuelve null si la firma no valida. */
  verifyWebhook(rawBody: string, signature: string, secret: string): WebhookEvent | null;
  refund(ctx: TenantContext, providerRef: string, amount: Money): Promise<{ ok: boolean }>;
}

/**
 * Provider fake para tests y para el flujo V1 "pago a la operación propia" antes de
 * integrar MP. Determinista.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private counter = 0;

  async createPayment(_ctx: TenantContext, intent: PaymentIntent): Promise<PaymentHandle> {
    this.counter += 1;
    return { providerRef: `fake_${intent.orderId}_${this.counter}`, clientSecret: "fake-secret" };
  }

  verifyWebhook(rawBody: string, signature: string): WebhookEvent | null {
    if (signature !== "valid") return null;
    return JSON.parse(rawBody) as WebhookEvent;
  }

  async refund(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}
