import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { TenantAwareDb } from "@commerce/platform";
import { freshModulesDb, seedTenantMerchant } from "../testsupport.js";
import { createProduct, addVariant } from "../catalog/catalog.js";
import { setStock, getStock } from "../inventory/inventory.js";
import { createOrder, getOrder, getOrderTracking } from "../orders/orders.js";
import { createPaymentIntent, expireAbandonedOnlinePayments, listLatePayments } from "./payments.js";
import { accountBalance, ledgerIsBalanced } from "./ledger.js";
import {
  MercadoPagoProvider,
  applyMercadoPagoPayment,
  parseMercadoPagoNotification,
  verifyMercadoPagoSignature,
  minorToMpAmount,
  mpAmountToMinor,
  type FetchLike,
  type MpPayment,
} from "./mercadopago.js";
import {
  saveMpCredentials,
  loadMpCredentials,
  getMpCredentialsStatus,
  isMpEnabled,
  setMpEnabled,
  setMpWebhookSecret,
  looksLikeMpAccessToken,
} from "./credentials.js";

const KEY = "clave-de-cifrado-de-plataforma-para-tests-0123456789";
const TOKEN = "APP_USR-1234567890123456-010203-abcdefabcdefabcdefabcdef-99887766";

/** fetch falso que registra las llamadas y responde lo que diga `routes`. */
function fakeFetch(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const fn: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, headers: init.headers, body });
    const key = `${init.method} ${url.replace("https://api.mercadopago.com", "")}`;
    const handler = routes[key];
    const r = handler ? handler(body) : { status: 404, json: { message: "not found" } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
  return { fn, calls };
}

describe("Mercado Pago — provider (Checkout Pro), firma y notificaciones", () => {
  it("crea la preferencia con monto en pesos, referencia = orderId, vencimiento y sin efectivo/cajero", async () => {
    const { fn, calls } = fakeFetch({
      "POST /checkout/preferences": () => ({ json: { id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" } }),
    });
    const mp = new MercadoPagoProvider({
      accessToken: TOKEN,
      fetch: fn,
      notificationUrl: "https://shop.example/api/webhooks/payments/m1?tenant=t",
      backUrls: { success: "https://s/ok", pending: "https://s/pend", failure: "https://s/err" },
      title: "Pedido Pet Shop",
      statementDescriptor: "PET SHOP GUALEGUAY CON NOMBRE LARGO",
      expiresInSeconds: 3600,
      now: () => new Date("2026-10-09T12:00:00.000Z"),
    });
    const h = await mp.createPayment(
      { tenantId: "t", actor: { type: "system", id: "x" } },
      { orderId: "order-1", amount: { amountMinor: 3_150_050n, currency: "ARS" }, idempotencyKey: "idem-1" },
    );
    expect(h.providerRef).toBe("order-1");
    expect(h.redirectUrl).toContain("pref_id=pref-1");

    const c = calls[0]!;
    expect(c.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(c.headers["x-idempotency-key"]).toBe("idem-1");
    const b = c.body as Record<string, any>;
    expect(b.items[0].unit_price).toBe(31500.5);
    expect(b.items[0].currency_id).toBe("ARS");
    expect(b.external_reference).toBe("order-1");
    expect(b.notification_url).toContain("/api/webhooks/payments/m1");
    expect(b.auto_return).toBe("approved");
    expect(b.statement_descriptor.length).toBeLessThanOrEqual(22);
    expect(b.expiration_date_to).toBe("2026-10-09T13:00:00.000Z");
    expect(b.payment_methods.excluded_payment_types).toEqual([{ id: "ticket" }, { id: "atm" }]);
  });

  it("consulta el pago y convierte el monto a centavos sin float", async () => {
    const { fn } = fakeFetch({
      "GET /v1/payments/555": () => ({ json: { id: 555, status: "approved", status_detail: "accredited", external_reference: "o1", transaction_amount: 31500.5, currency_id: "ARS", live_mode: true } }),
    });
    const p = await new MercadoPagoProvider({ accessToken: TOKEN, fetch: fn }).getPayment("555");
    expect(p).toEqual({ id: "555", status: "approved", statusDetail: "accredited", externalReference: "o1", amountMinor: 3_150_050n, currency: "ARS", liveMode: true });
    expect(minorToMpAmount(1999n)).toBe(19.99);
    expect(mpAmountToMinor(19.99)).toBe(1999n);
  });

  it("propaga errores HTTP de MP (p. ej. token inválido)", async () => {
    const { fn } = fakeFetch({ "GET /users/me": () => ({ status: 401, json: { message: "invalid access token" } }) });
    await expect(new MercadoPagoProvider({ accessToken: TOKEN, fetch: fn }).whoAmI()).rejects.toThrow(/mp_http_401: invalid access token/);
  });

  it("parsea notificaciones de pago (query o body) e ignora otros tópicos", () => {
    expect(parseMercadoPagoNotification({ query: new URLSearchParams("data.id=123&type=payment"), body: {} })).toEqual({ paymentId: "123" });
    expect(parseMercadoPagoNotification({ query: new URLSearchParams(""), body: { type: "payment", data: { id: 456 } } })).toEqual({ paymentId: "456" });
    expect(parseMercadoPagoNotification({ query: new URLSearchParams("topic=merchant_order&id=9"), body: {} })).toBeNull();
    expect(parseMercadoPagoNotification({ query: new URLSearchParams("type=payment&data.id=../../x"), body: {} })).toBeNull();
  });

  it("valida la firma x-signature (HMAC del manifiesto) y rechaza alteraciones y replays viejos", () => {
    const secret = "secreto-webhooks";
    const ts = "1760000000";
    const manifest = `id:123;request-id:req-1;ts:${ts};`;
    const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
    const header = `ts=${ts},v1=${v1}`;
    const nowMs = 1760000000 * 1000 + 60_000;
    const base = { signatureHeader: header, requestId: "req-1", dataId: "123", secret, nowMs, maxAgeSeconds: 600 };
    expect(verifyMercadoPagoSignature(base)).toBe(true);
    expect(verifyMercadoPagoSignature({ ...base, dataId: "124" })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, requestId: "req-2" })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, secret: "otro" })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, nowMs: nowMs + 3600_000 })).toBe(false);
    expect(verifyMercadoPagoSignature({ ...base, signatureHeader: null })).toBe(false);
  });

  it("reconoce el formato de los tokens", () => {
    expect(looksLikeMpAccessToken(TOKEN)).toBe(true);
    expect(looksLikeMpAccessToken("TEST-1234567890123456-010203-abcdef")).toBe(true);
    expect(looksLikeMpAccessToken("cualquier cosa")).toBe(false);
  });
});

describe("Mercado Pago — credenciales cifradas y aplicación del pago al pedido", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("guarda el token cifrado; el estado del panel nunca lo expone", async () => {
    await db.withTenant(tenantId, (tx) =>
      saveMpCredentials(tx, { tenantId, merchantId, accessToken: TOKEN, webhookSecret: "whsec", account: { id: "99887766", nickname: "PETSHOP" }, encryptionKey: KEY }),
    );
    const raw = await db.withTenant(tenantId, (tx) => tx.query<{ access_token_sealed: string; webhook_secret_sealed: string }>("select access_token_sealed, webhook_secret_sealed from payment_credentials"));
    expect(raw[0]!.access_token_sealed).not.toContain("APP_USR");
    expect(raw[0]!.webhook_secret_sealed).not.toContain("whsec");

    const status = await db.withTenant(tenantId, (tx) => getMpCredentialsStatus(tx, merchantId));
    expect(status).toMatchObject({ configured: true, enabled: true, liveMode: true, tokenHint: "…7766", hasWebhookSecret: true, accountNickname: "PETSHOP" });
    expect(JSON.stringify(status)).not.toContain("APP_USR");

    const creds = await db.withTenant(tenantId, (tx) => loadMpCredentials(tx, merchantId, KEY));
    expect(creds?.accessToken).toBe(TOKEN);
    expect(creds?.webhookSecret).toBe("whsec");

    // Re-guardar el token sin mandar secreto conserva el secreto; desactivar apaga "Pagar ahora".
    await db.withTenant(tenantId, (tx) =>
      saveMpCredentials(tx, { tenantId, merchantId, accessToken: TOKEN, account: { id: "99887766", nickname: "PETSHOP" }, encryptionKey: KEY }),
    );
    expect((await db.withTenant(tenantId, (tx) => loadMpCredentials(tx, merchantId, KEY)))?.webhookSecret).toBe("whsec");
    await db.withTenant(tenantId, (tx) => setMpEnabled(tx, merchantId, false));
    expect(await db.withTenant(tenantId, (tx) => isMpEnabled(tx, merchantId))).toBe(false);
    await db.withTenant(tenantId, (tx) => setMpEnabled(tx, merchantId, true));
    await db.withTenant(tenantId, (tx) => setMpWebhookSecret(tx, { merchantId, webhookSecret: null, encryptionKey: KEY }));
    expect((await db.withTenant(tenantId, (tx) => getMpCredentialsStatus(tx, merchantId))).hasWebhookSecret).toBe(false);
  });

  it("otro tenant no ve las credenciales (RLS)", async () => {
    const [t2] = await db.query<{ id: string }>("insert into tenants (slug,name) values ('otro','Otro') returning id");
    const rows = await db.withTenant(t2!.id, (tx) => tx.query("select 1 from payment_credentials"));
    expect(rows).toHaveLength(0);
  });

  async function newOnlineOrder(opts: { ttlSeconds?: number; stock?: number } = {}) {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "p-" + Math.random(), name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "S" + Math.random(), name: "S" });
      await setStock(tx, { tenantId, variantId, available: opts.stock ?? 5 });
      return variantId;
    });
    const created = await createOrder(db, {
      tenantId,
      paymentMethod: "online",
      deliveryChargeMinor: 120_000n,
      ...(opts.ttlSeconds !== undefined ? { reservationTtlSeconds: opts.ttlSeconds } : {}),
      sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 2_000_000n }] }],
    });
    if (!created.ok) throw new Error(created.error);
    const orderId = created.value.orderId;
    const { fn } = fakeFetch({ "POST /checkout/preferences": () => ({ json: { id: "pref", init_point: "https://mp/redirect" } }) });
    const intent = await createPaymentIntent(db, new MercadoPagoProvider({ accessToken: TOKEN, fetch: fn }), { tenantId, orderId, idempotencyKey: "k-" + orderId });
    if (!intent.ok) throw new Error(intent.error);
    return { orderId, variantId, intent: intent.value };
  }

  const mpPayment = (over: Partial<MpPayment>): MpPayment => ({
    id: String(Math.floor(Math.random() * 1e9)),
    status: "approved",
    statusDetail: "accredited",
    externalReference: null,
    amountMinor: 2_120_000n,
    currency: "ARS",
    liveMode: true,
    ...over,
  });

  it("el intent cobra exactamente lo que vio el cliente (productos + envío del checkout) y devuelve el redirect", async () => {
    const { intent } = await newOnlineOrder();
    expect(intent.amountMinor).toBe(2_120_000n);
    expect(intent.redirectUrl).toBe("https://mp/redirect");
  });

  it("approved → captura, ledger balanceado, pedido confirmado y pagado; repetir es no-op", async () => {
    const { orderId, variantId } = await newOnlineOrder();
    const before = await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId));
    const pay = mpPayment({ externalReference: orderId });

    const r1 = await applyMercadoPagoPayment(db, { tenantId, payment: pay });
    expect(r1.ok && r1.value.kind).toBe("captured");
    const r2 = await applyMercadoPagoPayment(db, { tenantId, payment: pay });
    expect(r2.ok && r2.value.kind).toBe("already_captured");

    // GMV 2.000.000, comisión 7% = 140.000 → comercio 1.860.000 (una sola vez).
    expect((await db.withTenant(tenantId, (tx) => accountBalance(tx, "merchant", merchantId))) - before).toBe(1_860_000n);
    expect(await db.withTenant(tenantId, (tx) => ledgerIsBalanced(tx))).toBe(true);
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))?.status).toBe("confirmed");
    const track = await db.withTenant(tenantId, (tx) => getOrderTracking(tx, orderId));
    expect(track).toMatchObject({ paymentMethod: "online", paymentStatus: "pagado", stage: "preparando" });
    expect((await db.withTenant(tenantId, (tx) => getStock(tx, variantId)))).toEqual({ available: 4, reserved: 0 });
    const [p] = await db.withTenant(tenantId, (tx) => tx.query<{ provider_payment_id: string; status: string }>("select provider_payment_id, status from payments where order_id = $1", [orderId]));
    expect(p).toEqual({ provider_payment_id: pay.id, status: "captured" });
  });

  it("monto distinto → no confirma (amount_mismatch)", async () => {
    const { orderId } = await newOnlineOrder();
    const r = await applyMercadoPagoPayment(db, { tenantId, payment: mpPayment({ externalReference: orderId, amountMinor: 100n }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/amount_mismatch/);
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))?.status).toBe("pending_payment");
  });

  it("rechazado/pendiente → no toca nada; referencia ajena → unknown_reference", async () => {
    const { orderId } = await newOnlineOrder();
    const r = await applyMercadoPagoPayment(db, { tenantId, payment: mpPayment({ externalReference: orderId, status: "rejected" }) });
    expect(r.ok && r.value).toEqual({ kind: "ignored", status: "rejected" });
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))?.status).toBe("pending_payment");
    const u = await applyMercadoPagoPayment(db, { tenantId, payment: mpPayment({ externalReference: "00000000-0000-0000-0000-000000000000" }) });
    expect(u.ok && u.value.kind).toBe("unknown_reference");
  });

  it("reserva vencida y liberada: re-reserva del stock al capturar", async () => {
    const { orderId, variantId } = await newOnlineOrder({ ttlSeconds: 1, stock: 3 });
    await db.withTenant(tenantId, (tx) => tx.query("update stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [orderId]));
    await db.tx((tx) => tx.query("select release_expired_reservations()"));
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 3, reserved: 0 });

    const r = await applyMercadoPagoPayment(db, { tenantId, payment: mpPayment({ externalReference: orderId }) });
    expect(r.ok && r.value).toEqual(expect.objectContaining({ kind: "captured" }));
    if (r.ok && r.value.kind === "captured") expect(r.value.stockShortfall).toBeUndefined();
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 2, reserved: 0 });
  });

  it("reserva vencida y sin stock: registra el cobro igual y avisa el faltante", async () => {
    const { orderId, variantId } = await newOnlineOrder({ ttlSeconds: 1, stock: 1 });
    await db.withTenant(tenantId, (tx) => tx.query("update stock_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [orderId]));
    await db.tx((tx) => tx.query("select release_expired_reservations()"));
    await db.withTenant(tenantId, (tx) => setStock(tx, { tenantId, variantId, available: 0 }));

    const r = await applyMercadoPagoPayment(db, { tenantId, payment: mpPayment({ externalReference: orderId }) });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "captured") expect(r.value.stockShortfall).toEqual([variantId]);
    const evts = await db.withTenant(tenantId, (tx) => tx.query<{ type: string }>("select type from outbox_events where type = 'order.stock_shortfall'"));
    expect(evts.length).toBeGreaterThan(0);
  });
});

describe("Mercado Pago — pedidos abandonados y pagos tardíos", () => {
  let pg: PGlite;
  let db: TenantAwareDb;
  let tenantId: string;
  let merchantId: string;

  beforeAll(async () => {
    ({ pg, db } = await freshModulesDb());
    ({ tenantId, merchantId } = await seedTenantMerchant(db));
  });
  afterAll(async () => {
    await pg?.close();
  });

  it("cancela el pedido online sin pagar, libera stock; una aprobación tardía queda para reembolsar", async () => {
    const variantId = await db.withTenant(tenantId, async (tx) => {
      const { productId } = await createProduct(tx, { tenantId, merchantId, slug: "ab", name: "P" });
      const { variantId } = await addVariant(tx, { tenantId, productId, sku: "AB", name: "S" });
      await setStock(tx, { tenantId, variantId, available: 2 });
      return variantId;
    });
    const created = await createOrder(db, { tenantId, paymentMethod: "online", sellers: [{ merchantId, items: [{ variantId, qty: 1, unitPriceMinor: 500_000n }] }] });
    if (!created.ok) throw new Error(created.error);
    const orderId = created.value.orderId;
    const { fn } = fakeFetch({ "POST /checkout/preferences": () => ({ json: { id: "p", init_point: "https://mp" } }) });
    await createPaymentIntent(db, new MercadoPagoProvider({ accessToken: TOKEN, fetch: fn }), { tenantId, orderId, idempotencyKey: "ab" });

    // Recién creado: no se toca.
    expect(await expireAbandonedOnlinePayments(db, tenantId, 72)).toBe(0);
    await db.withTenant(tenantId, (tx) => tx.query("update orders set created_at = now() - interval '4 days' where id = $1", [orderId]));
    expect(await expireAbandonedOnlinePayments(db, tenantId, 72)).toBe(1);
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))?.status).toBe("cancelled");
    expect(await db.withTenant(tenantId, (tx) => getStock(tx, variantId))).toEqual({ available: 2, reserved: 0 });

    const late = await applyMercadoPagoPayment(db, {
      tenantId,
      payment: { id: "777", status: "approved", statusDetail: null, externalReference: orderId, amountMinor: 500_000n, currency: "ARS", liveMode: true },
    });
    expect(late.ok && late.value).toEqual({ kind: "late_payment", mpPaymentId: "777", orderId });
    expect((await db.withTenant(tenantId, (tx) => getOrder(tx, orderId)))?.status).toBe("cancelled");
    const review = await db.withTenant(tenantId, (tx) => listLatePayments(tx));
    expect(review.map((r) => r.providerPaymentId)).toEqual(["777"]);
  });
});
