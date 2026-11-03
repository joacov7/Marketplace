-- Tokens de invitación y recuperación de acceso del panel.
-- Tabla de infraestructura cross-tenant: el token se busca por hash antes de que exista
-- una sesión. No guardar nunca el token en claro; solo SHA-256.
-- No habilitar RLS: los endpoints públicos necesitan validar el token sin sesión.
create table if not exists auth_email_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   char(64) not null unique,
  purpose      text not null check (purpose in ('owner_invitation','staff_invitation','password_reset')),
  tenant_id    uuid not null references tenants(id),
  email        text not null,
  role         text,
  scope_type   text,
  scope_id     text,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists auth_email_tokens_lookup
  on auth_email_tokens (token_hash, purpose, expires_at)
  where consumed_at is null;

create index if not exists auth_email_tokens_tenant_email
  on auth_email_tokens (tenant_id, lower(email), purpose, created_at desc);
