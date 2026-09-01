-- F4 — Delivery. Guarda origen/destino/costo/cadete/eventos (sección 7 del doc). El
-- modelo YA soporta consolidación futura (V4): `routes` agrupa varias `deliveries` con
-- múltiples pickups, sin rehacer nada. V1: 1 seller_order → 1 delivery, sin route.
-- Montos en centavos (D7). Todo bajo RLS por tenant.

create table if not exists drivers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  name       text not null,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists delivery_zones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  region_id  uuid references regions(id),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Tarifa por zona: costo del cadete + lo que paga el cliente + quién financia el gap.
create table if not exists delivery_rates (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  zone_id               uuid not null references delivery_zones(id),
  cadete_cost_minor     bigint not null check (cadete_cost_minor >= 0),
  customer_charge_minor bigint not null check (customer_charge_minor >= 0),
  subsidy_source        text not null default 'platform' check (subsidy_source in ('platform','merchant','promo','none')),
  created_at            timestamptz not null default now()
);

-- Route: agrupa entregas (consolidación V4). Presente desde ya, sin usar en V1.
create table if not exists routes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  driver_id  uuid references drivers(id),
  status     text not null default 'planned' check (status in ('planned','in_progress','completed')),
  created_at timestamptz not null default now()
);

create table if not exists deliveries (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  seller_order_id       uuid not null references seller_orders(id),
  route_id              uuid references routes(id),
  driver_id             uuid references drivers(id),
  zone_id               uuid references delivery_zones(id),
  status                text not null default 'pending'
                        check (status in ('pending','assigned','picked_up','in_transit','delivered','failed')),
  cadete_cost_minor     bigint not null default 0 check (cadete_cost_minor >= 0),
  customer_charge_minor bigint not null default 0 check (customer_charge_minor >= 0),
  subsidy_source        text not null default 'platform',
  eta_minutes           int,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists deliveries_by_seller_order on deliveries (seller_order_id);

create table if not exists delivery_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  delivery_id uuid not null references deliveries(id),
  type        text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['drivers','delivery_zones','delivery_rates','routes','deliveries','delivery_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())',
      t
    );
  end loop;
end $$;
