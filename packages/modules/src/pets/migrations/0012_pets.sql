-- Perfiles de mascota del cliente ("los animales de la casa"). Base de la calculadora de
-- consumo y de los avisos de reposición. Por tenant y bajo RLS. Idempotente.
-- activity: etapa/actividad (cachorro, adulto_bajo, adulto_normal, adulto_activo, senior).

create table if not exists pets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null,
  name        text not null,
  species     text not null default 'perro' check (species in ('perro','gato','otro')),
  breed       text,
  weight_kg   numeric(6,2),
  activity    text not null default 'adulto_normal',
  created_at  timestamptz not null default now()
);
create index if not exists pets_by_customer on pets (customer_id, created_at desc);

do $$
begin
  execute 'alter table pets enable row level security';
  execute 'alter table pets force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'pets' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on pets using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;
