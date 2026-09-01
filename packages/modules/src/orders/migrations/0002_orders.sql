-- F3 — Órdenes. Esqueleto a prueba de multi-seller SIN rehacer Order ([E1]):
--   order (1 checkout del cliente) → seller_order (la parte de UN comercio) → order_item
--   Los items cuelgan de seller_order, NO de order → multi-seller = N seller_orders.
--   V1: 1 seller_order por order, forzado por config (orders.maxSellersPerOrder), no acá.
-- Montos en centavos (D7). Todo bajo RLS por tenant.

create table if not exists orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid,
  status      text not null default 'pending_payment'
              check (status in ('pending_payment','confirmed','completed','cancelled','refunded','partially_refunded')),
  currency    char(3) not null default 'ARS',
  total_minor bigint not null default 0 check (total_minor >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists seller_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  order_id       uuid not null references orders(id),
  merchant_id    uuid not null references merchants(id),
  status         text not null default 'pending'
                 check (status in ('pending','preparing','ready','in_transit','delivered','rejected','delivery_failed','cancelled')),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  created_at     timestamptz not null default now()
);
create index if not exists seller_orders_by_order on seller_orders (order_id);

create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  seller_order_id  uuid not null references seller_orders(id),
  variant_id       uuid not null references variants(id),
  qty              int not null check (qty > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  reservation_id   uuid,
  created_at       timestamptz not null default now()
);
create index if not exists order_items_by_seller_order on order_items (seller_order_id);

do $$
declare t text;
begin
  foreach t in array array['orders','seller_orders','order_items'] loop
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
