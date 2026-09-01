-- F3 (parte 2) — Payments + LEDGER de doble partida (fuente de verdad del dinero).
-- payment (1 por order) → payment_allocation (reparto: merchant/comisión/delivery/…).
-- ledger_entries: doble partida; cada asiento balancea (sum debit = sum credit).
-- refunds: reversos; un refund parcial afecta UNA allocation sin tocar las demás (#9).
-- processed_webhooks: idempotencia de webhooks (dedup por provider_event_id).
-- Montos en centavos (D7). Todo bajo RLS por tenant.

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  order_id     uuid not null references orders(id),
  provider     text not null,
  provider_ref text,
  status       text not null default 'pending' check (status in ('pending','captured','failed','refunded','partially_refunded')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency     char(3) not null default 'ARS',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists payments_by_order on payments (order_id);

create table if not exists payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  payment_id      uuid not null references payments(id),
  seller_order_id uuid references seller_orders(id),
  target_type     text not null check (target_type in ('merchant','platform_commission','delivery','psp_fee','promo_subsidy')),
  target_ref      text,
  amount_minor    bigint not null check (amount_minor >= 0),
  refunded_minor  bigint not null default 0 check (refunded_minor >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists allocations_by_payment on payment_allocations (payment_id);

create table if not exists ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  payment_id   uuid references payments(id),
  account      text not null,
  account_ref  text,
  debit_minor  bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  memo         text,
  created_at   timestamptz not null default now()
);
create index if not exists ledger_by_account on ledger_entries (account, account_ref);

create table if not exists refunds (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  payment_id    uuid not null references payments(id),
  allocation_id uuid references payment_allocations(id),
  amount_minor  bigint not null check (amount_minor > 0),
  reason        text,
  created_at    timestamptz not null default now()
);

create table if not exists processed_webhooks (
  provider_event_id text primary key,
  tenant_id         uuid not null,
  payment_id        uuid,
  processed_at      timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['payments','payment_allocations','ledger_entries','refunds','processed_webhooks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    if not exists (select from pg_policies where schemaname = 'public' and tablename = t and policyname = 'tenant_isolation') then
      execute format(
        'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
        t
      );
    end if;
  end loop;
end $$;
