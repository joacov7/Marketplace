-- Botón de arrepentimiento (Ley 24.240 art. 34; Res. SCI 424/2020): el cliente pide revocar
-- su compra sin registrarse y recibe un código de identificación de la solicitud. El comercio
-- las ve y resuelve desde el panel. Solo agrega una tabla: no toca datos existentes. Idempotente.
create table if not exists withdrawal_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  code         text not null,
  name         text not null,
  contact      text not null,
  order_ref    text,
  message      text,
  status       text not null default 'pendiente' check (status in ('pendiente','resuelta')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (tenant_id, code)
);
create index if not exists withdrawal_requests_by_status on withdrawal_requests (tenant_id, status, created_at desc);

alter table withdrawal_requests enable row level security;
alter table withdrawal_requests force row level security;
do $$
begin
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'withdrawal_requests' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on withdrawal_requests
      using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
  end if;
end $$;
