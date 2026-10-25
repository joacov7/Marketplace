-- Club de puntos. El saldo de un cliente es la SUMA de sus movimientos (no se guarda aparte,
-- así no hay dos fuentes de verdad). Movimientos:
--   earn   (+) pedido entregado (uno por pedido: índice único → idempotente)
--   store  (+) compra en el local cargada desde el panel
--   redeem (−) canje de un premio
--   adjust (±) corrección manual del comercio
-- Solo agrega tablas: no toca datos existentes. Idempotente. RLS por tenant.
create table if not exists loyalty_rewards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  name        text not null check (length(name) between 1 and 120),
  points_cost int not null check (points_cost > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists loyalty_movements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null references customers(id),
  points      int not null check (points <> 0),
  kind        text not null check (kind in ('earn','store','redeem','adjust')),
  order_id    uuid references orders(id),
  reward_id   uuid references loyalty_rewards(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists loyalty_movements_by_customer on loyalty_movements (customer_id, created_at desc);
create unique index if not exists loyalty_earn_once_per_order on loyalty_movements (order_id) where kind = 'earn';

do $$
declare t text;
begin
  foreach t in array array['loyalty_rewards','loyalty_movements'] loop
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
