import { type Db, sealSecret, openSecret } from "@commerce/platform";

/**
 * Credenciales del PSP por comercio (hoy: Mercado Pago). El Access Token y el secreto de
 * webhooks se guardan CIFRADOS con la clave de plataforma (`encryptionKey`, de una env var):
 * nunca en claro en la base, y nunca vuelven al navegador — el panel solo ve una pista
 * ("…1234"), si está activo y a qué cuenta pertenece.
 * Todas las funciones corren dentro de `withTenant` (RLS).
 */

export interface MpCredentialsStatus {
  configured: boolean;
  enabled: boolean;
  liveMode: boolean;
  tokenHint: string | null;
  hasWebhookSecret: boolean;
  accountId: string | null;
  accountNickname: string | null;
  updatedAt: string | null;
}

export interface MpCredentials {
  merchantId: string;
  accessToken: string;
  webhookSecret: string | null;
  enabled: boolean;
  liveMode: boolean;
}

/** Los tokens de prueba de MP empiezan con TEST-; los productivos con APP_USR-. */
export function isMpLiveToken(token: string): boolean {
  return token.startsWith("APP_USR-");
}

export function looksLikeMpAccessToken(token: string): boolean {
  return /^(APP_USR|TEST)-[A-Za-z0-9-]{20,}$/.test(token);
}

function hintOf(token: string): string {
  return `…${token.slice(-4)}`;
}

/**
 * Guarda (o reemplaza) las credenciales. `webhookSecret`: undefined = conservar la actual,
 * null/"" = borrarla. El token se valida antes contra MP (lo hace el caller con `whoAmI`).
 */
export async function saveMpCredentials(
  tx: Db,
  input: {
    tenantId: string;
    merchantId: string;
    accessToken: string;
    webhookSecret?: string | null;
    account: { id: string; nickname: string | null };
    encryptionKey: string;
  },
): Promise<void> {
  const tokenSealed = sealSecret(input.accessToken, input.encryptionKey);
  const keepSecret = input.webhookSecret === undefined;
  const secretSealed = input.webhookSecret ? sealSecret(input.webhookSecret, input.encryptionKey) : null;
  await tx.query(
    `insert into payment_credentials
       (tenant_id, merchant_id, provider, access_token_sealed, webhook_secret_sealed, access_token_hint,
        live_mode, enabled, account_id, account_nickname)
     values ($1,$2,'mercadopago',$3,$4,$5,$6,true,$7,$8)
     on conflict (merchant_id, provider) do update set
       access_token_sealed   = excluded.access_token_sealed,
       webhook_secret_sealed = case when $9 then payment_credentials.webhook_secret_sealed else excluded.webhook_secret_sealed end,
       access_token_hint     = excluded.access_token_hint,
       live_mode             = excluded.live_mode,
       account_id            = excluded.account_id,
       account_nickname      = excluded.account_nickname,
       updated_at            = now()`,
    [
      input.tenantId,
      input.merchantId,
      tokenSealed,
      secretSealed,
      hintOf(input.accessToken),
      isMpLiveToken(input.accessToken),
      input.account.id,
      input.account.nickname,
      keepSecret,
    ],
  );
}

/** Cambia solo el secreto de webhooks (sin re-ingresar el token). */
export async function setMpWebhookSecret(
  tx: Db,
  input: { merchantId: string; webhookSecret: string | null; encryptionKey: string },
): Promise<boolean> {
  const sealed = input.webhookSecret ? sealSecret(input.webhookSecret, input.encryptionKey) : null;
  const rows = await tx.query(
    `update payment_credentials set webhook_secret_sealed = $2, updated_at = now()
      where merchant_id = $1 and provider = 'mercadopago' returning id`,
    [input.merchantId, sealed],
  );
  return rows.length > 0;
}

export async function setMpEnabled(tx: Db, merchantId: string, enabled: boolean): Promise<boolean> {
  const rows = await tx.query(
    `update payment_credentials set enabled = $2, updated_at = now()
      where merchant_id = $1 and provider = 'mercadopago' returning id`,
    [merchantId, enabled],
  );
  return rows.length > 0;
}

export async function deleteMpCredentials(tx: Db, merchantId: string): Promise<void> {
  await tx.query(`delete from payment_credentials where merchant_id = $1 and provider = 'mercadopago'`, [merchantId]);
}

/** Estado para el panel: NUNCA devuelve el token ni el secreto. */
export async function getMpCredentialsStatus(tx: Db, merchantId: string): Promise<MpCredentialsStatus> {
  const [r] = await tx.query<{
    enabled: boolean;
    live_mode: boolean;
    access_token_hint: string;
    has_secret: boolean;
    account_id: string | null;
    account_nickname: string | null;
    updated_at: string;
  }>(
    `select enabled, live_mode, access_token_hint, (webhook_secret_sealed is not null) as has_secret,
            account_id, account_nickname, updated_at
       from payment_credentials where merchant_id = $1 and provider = 'mercadopago'`,
    [merchantId],
  );
  if (!r) {
    return { configured: false, enabled: false, liveMode: false, tokenHint: null, hasWebhookSecret: false, accountId: null, accountNickname: null, updatedAt: null };
  }
  return {
    configured: true,
    enabled: r.enabled,
    liveMode: r.live_mode,
    tokenHint: r.access_token_hint,
    hasWebhookSecret: r.has_secret,
    accountId: r.account_id,
    accountNickname: r.account_nickname,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** ¿Se puede ofrecer "Pagar ahora"? (credenciales cargadas y activas). No descifra nada. */
export async function isMpEnabled(tx: Db, merchantId: string): Promise<boolean> {
  const [r] = await tx.query<{ enabled: boolean }>(
    `select enabled from payment_credentials where merchant_id = $1 and provider = 'mercadopago'`,
    [merchantId],
  );
  return !!r?.enabled;
}

/** Credenciales descifradas, solo para el server (crear preferencias, consultar pagos). */
export async function loadMpCredentials(tx: Db, merchantId: string, encryptionKey: string): Promise<MpCredentials | null> {
  const [r] = await tx.query<{
    merchant_id: string;
    access_token_sealed: string;
    webhook_secret_sealed: string | null;
    enabled: boolean;
    live_mode: boolean;
  }>(
    `select merchant_id, access_token_sealed, webhook_secret_sealed, enabled, live_mode
       from payment_credentials where merchant_id = $1 and provider = 'mercadopago'`,
    [merchantId],
  );
  if (!r) return null;
  return {
    merchantId: r.merchant_id,
    accessToken: openSecret(r.access_token_sealed, encryptionKey),
    webhookSecret: r.webhook_secret_sealed ? openSecret(r.webhook_secret_sealed, encryptionKey) : null,
    enabled: r.enabled,
    liveMode: r.live_mode,
  };
}
