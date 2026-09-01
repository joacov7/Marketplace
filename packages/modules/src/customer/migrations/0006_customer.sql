-- Checkout completo (Grupo A). Libreta de direcciones del cliente, bajo RLS por tenant.
create table if not exists addresses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null,
  label       text,
  street      text not null,
  city        text,
  zone        text,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists addresses_by_customer on addresses (customer_id);

do $$
begin
  execute 'alter table addresses enable row level security';
  execute 'alter table addresses force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'addresses' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on addresses using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;
