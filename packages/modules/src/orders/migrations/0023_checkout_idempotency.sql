-- Idempotencia del checkout: un doble clic o un reintento (red móvil que corta) con la misma
-- Idempotency-Key NO crea un segundo pedido; devuelve la respuesta del primero.
-- Una fila por (tenant, clave). `response` null = en curso; `order_id` se graba apenas se crea
-- el pedido. Las filas viejas (7 días) se borran solas al reclamar una clave nueva.
-- Solo agrega una tabla: no toca datos existentes. Idempotente.
create table if not exists checkout_requests (
  tenant_id       uuid not null,
  idempotency_key text not null,
  request_hash    text not null,
  order_id        uuid,
  response_status int,
  response        jsonb,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);
create index if not exists checkout_requests_created on checkout_requests (tenant_id, created_at);

alter table checkout_requests enable row level security;
alter table checkout_requests force row level security;
do $$
begin
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'checkout_requests' and policyname = 'tenant_isolation') then
    create policy tenant_isolation on checkout_requests
      using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
  end if;
end $$;
