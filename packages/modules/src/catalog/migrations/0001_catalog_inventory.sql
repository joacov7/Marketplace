-- F2 — Catálogo e Inventario. Tablas propias de estos módulos (cada módulo dueño de sus
-- tablas — [A1]). Todas scopeadas por tenant y bajo RLS. Los montos son bigint en
-- centavos (D7). Depende de 0000_init.sql (tenants/regions/merchants + rol commerce_app).

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  merchant_id uuid not null references merchants(id),
  slug        text not null,
  name        text not null,
  description text,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  unique (merchant_id, slug)
);

create table if not exists variants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  product_id uuid not null references products(id),
  sku        text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (product_id, sku)
);

create table if not exists prices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  variant_id     uuid not null references variants(id),
  amount_minor   bigint not null check (amount_minor >= 0),
  currency       char(3) not null default 'ARS',
  effective_from timestamptz not null default now()
);
create index if not exists prices_lookup on prices (variant_id, effective_from desc);

-- Inventario: available = disponible para vender, reserved = retenido por reservas 'held'.
create table if not exists inventory (
  variant_id uuid primary key references variants(id),
  tenant_id  uuid not null,
  available  int not null default 0 check (available >= 0),
  reserved   int not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now()
);

-- Reservas de stock con TTL (evita oversell — [G1]). held → confirmed (venta) | released.
create table if not exists stock_reservations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  order_id   uuid,
  variant_id uuid not null references variants(id),
  qty        int not null check (qty > 0),
  status     text not null default 'held' check (status in ('held','confirmed','released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists stock_res_expiry on stock_reservations (status, expires_at);

-- RLS en todas las tablas de dominio (scopeadas por tenant).
do $$
declare t text;
begin
  foreach t in array array['products','variants','prices','inventory','stock_reservations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
  end loop;
end $$;

-- Libera reservas vencidas y devuelve el stock. SECURITY DEFINER: la corre el cron como
-- tarea de plataforma (cross-tenant), por eso bypassea RLS a propósito. Devuelve cuántas
-- reservas liberó.
create or replace function release_expired_reservations() returns int
  language plpgsql security definer as $$
declare n int;
begin
  with expired as (
    update stock_reservations set status = 'released'
     where status = 'held' and expires_at < now()
     returning variant_id, qty
  ), agg as (
    select variant_id, sum(qty)::int as q from expired group by variant_id
  )
  update inventory i
     set available = i.available + a.q, reserved = i.reserved - a.q, updated_at = now()
    from agg a
   where i.variant_id = a.variant_id;
  get diagnostics n = row_count;
  return coalesce(n, 0);
end $$;
