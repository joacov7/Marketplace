-- Mercado Pago real ("Pagar ahora").
-- 1) payment_credentials: credenciales del PSP POR COMERCIO. El Access Token y el secreto de
--    webhooks se guardan CIFRADOS (AES-256-GCM, clave en la env var PAYMENTS_ENCRYPTION_KEY,
--    nunca en la base). Bajo RLS por tenant como el resto.
-- 2) payments.provider_payment_id: id del pago en el PSP (en MP, el `payment.id`), para
--    conciliar y para reembolsar. provider_ref sigue siendo nuestra referencia (external_reference).

create table if not exists payment_credentials (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  merchant_id           uuid not null references merchants(id),
  provider              text not null check (provider in ('mercadopago')),
  access_token_sealed   text not null,
  webhook_secret_sealed text,
  -- Pista no sensible para mostrar en el panel ("…1234") sin descifrar.
  access_token_hint     text not null,
  live_mode             boolean not null default false,
  enabled               boolean not null default true,
  -- Cuenta de MP a la que pertenece el token (validada contra /users/me al guardar).
  account_id            text,
  account_nickname      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (merchant_id, provider)
);

do $$
begin
  execute 'alter table payment_credentials enable row level security';
  execute 'alter table payment_credentials force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'payment_credentials' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on payment_credentials using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;

alter table payments add column if not exists provider_payment_id text;
create index if not exists payments_by_provider_ref on payments (provider_ref) where provider_ref is not null;
