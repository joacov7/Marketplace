-- Suscripción de auto-envío (flywheel: retención). El cliente se suscribe a su alimento y
-- cada X días se genera el pedido SOLO (entra a la cola del panel como los demás), cobrado
-- al recibir. No requiere Mercado Pago. La mascota sigue siendo el centro (pet_name snapshot).
--
-- Solo DDL (en Neon la app corre con FORCE RLS y current_tenant_id() es NULL durante la
-- migración). Aislamiento por tenant vía RLS, igual que el resto.

create table if not exists subscriptions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  customer_id     uuid,                       -- ficha del cliente (por teléfono o usuario)
  merchant_id     uuid not null,
  variant_id      uuid not null,
  qty             int  not null default 1 check (qty > 0),
  interval_days   int  not null check (interval_days between 1 and 365),
  next_run_at     timestamptz not null,       -- cuándo se genera el próximo envío
  status          text not null default 'active' check (status in ('active','paused','cancelled')),
  payment_method  text not null default 'efectivo',
  discount_percent int not null default 0 check (discount_percent between 0 and 90),
  pet_id          uuid,
  pet_name        text,
  ship_street     text,
  ship_zone       text,
  ship_phone      text,
  ship_notes      text,
  ship_lat        double precision,
  ship_lng        double precision,
  last_order_id   uuid,
  last_run_at     timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Índice para la búsqueda de suscripciones "vencidas" (due) por el cron.
create index if not exists subscriptions_due on subscriptions (tenant_id, status, next_run_at);

do $$
begin
  execute 'alter table subscriptions enable row level security';
  execute 'alter table subscriptions force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on subscriptions using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;

-- El pedido generado por la suscripción entra con canal 'suscripcion'. Reescribimos el check
-- de canal (0013) para incluirlo. drop+add es idempotente (las migraciones corren una vez).
alter table orders drop constraint if exists orders_channel_check;
alter table orders add constraint orders_channel_check check (channel in ('web','whatsapp','telefono','mostrador','suscripcion'));
