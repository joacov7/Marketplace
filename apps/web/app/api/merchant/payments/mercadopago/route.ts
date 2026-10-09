import { NextResponse } from "next/server";
import {
  deleteMpCredentials,
  getMpCredentialsStatus,
  listLatePayments,
  looksLikeMpAccessToken,
  MercadoPagoProvider,
  saveMpCredentials,
  setMpEnabled,
  setMpWebhookSecret,
} from "@commerce/modules/payments";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireAdminForTenant } from "@/lib/auth";
import { mainMerchantId, mpApiBase, paymentsEncryptionKey, publicOrigin, webhookUrl } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

/**
 * Conexión de Mercado Pago del comercio (panel → Configuración → Cobros online).
 *  GET    → estado (nunca el token: solo "…1234", cuenta, si está activo) + URL de webhooks.
 *  PUT    → { accessToken?, webhookSecret?, enabled? }. El token se valida contra MP
 *           (/users/me) antes de guardarlo, cifrado.
 *  DELETE → desconecta (borra las credenciales; "Pagar ahora" deja de ofrecerse).
 * Gate: código maestro o sesión de admin DE ESTE tenant (son las llaves de la plata).
 */
async function context(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return { error: NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 }) };
  if (!requireAdminForTenant(tenant.tenantId)) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const merchantId = await mainMerchantId(tenant.tenantId);
  if (!merchantId) return { error: NextResponse.json({ error: "no_merchant" }, { status: 400 }) };
  return { tenant, merchantId };
}

export async function GET(req: Request) {
  const c = await context(req);
  if ("error" in c) return c.error;
  const [status, late] = await db().withTenant(c.tenant.tenantId, (tx) =>
    Promise.all([getMpCredentialsStatus(tx, c.merchantId), listLatePayments(tx)]),
  );
  return NextResponse.json({
    ...status,
    // Pagos aprobados en MP sobre pedidos ya cancelados por abandono → reembolsar desde MP.
    latePayments: late.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() })),
    encryptionReady: !!paymentsEncryptionKey(),
    webhookUrl: webhookUrl(publicOrigin(req), c.merchantId, c.tenant.slug),
  });
}

export async function PUT(req: Request) {
  const c = await context(req);
  if ("error" in c) return c.error;
  const key = paymentsEncryptionKey();
  if (!key) {
    return NextResponse.json(
      { error: "Falta configurar PAYMENTS_ENCRYPTION_KEY en Vercel (ver el manual de operación)." },
      { status: 400 },
    );
  }

  let body: { accessToken?: string; webhookSecret?: string | null; enabled?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { tenantId } = c.tenant;
  const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret.trim() || null : body.webhookSecret;
  if (typeof webhookSecret === "string" && webhookSecret.length > 200) {
    return NextResponse.json({ error: "La clave secreta es demasiado larga." }, { status: 400 });
  }

  if (typeof body.accessToken === "string" && body.accessToken.trim()) {
    const accessToken = body.accessToken.trim();
    if (!looksLikeMpAccessToken(accessToken)) {
      return NextResponse.json(
        { error: "Eso no parece un Access Token de Mercado Pago (empieza con APP_USR- o TEST-)." },
        { status: 400 },
      );
    }
    let account;
    try {
      account = await new MercadoPagoProvider({ accessToken, ...mpApiBase() }).whoAmI();
    } catch (e) {
      const msg = String(e);
      return NextResponse.json(
        { error: /mp_http_401|mp_http_403/.test(msg) ? "Mercado Pago rechazó el Access Token. Revisá que esté completo y vigente." : "No pudimos validar el token con Mercado Pago. Probá de nuevo en un rato." },
        { status: 400 },
      );
    }
    await db().withTenant(tenantId, (tx) =>
      saveMpCredentials(tx, {
        tenantId,
        merchantId: c.merchantId,
        accessToken,
        ...(webhookSecret !== undefined ? { webhookSecret } : {}),
        account,
        encryptionKey: key,
      }),
    );
  } else if (webhookSecret !== undefined) {
    const updated = await db().withTenant(tenantId, (tx) =>
      setMpWebhookSecret(tx, { merchantId: c.merchantId, webhookSecret, encryptionKey: key }),
    );
    if (!updated) return NextResponse.json({ error: "Primero cargá el Access Token." }, { status: 400 });
  }

  if (typeof body.enabled === "boolean") {
    const updated = await db().withTenant(tenantId, (tx) => setMpEnabled(tx, c.merchantId, body.enabled!));
    if (!updated) return NextResponse.json({ error: "Primero cargá el Access Token." }, { status: 400 });
  }

  const status = await db().withTenant(tenantId, (tx) => getMpCredentialsStatus(tx, c.merchantId));
  return NextResponse.json({ ok: true, ...status });
}

export async function DELETE(req: Request) {
  const c = await context(req);
  if ("error" in c) return c.error;
  await db().withTenant(c.tenant.tenantId, (tx) => deleteMpCredentials(tx, c.merchantId));
  return NextResponse.json({ ok: true });
}
