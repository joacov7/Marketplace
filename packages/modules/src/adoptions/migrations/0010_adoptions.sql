-- Adopciones / callejeritos: publicaciones de mascotas en adopción del comercio (o de la
-- comunidad). Tabla propia del módulo, por tenant y bajo RLS. Idempotente.
-- status: 'available' (se muestra en la tienda) | 'adopted' (dado en adopción, oculto).

create table if not exists adoptions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  name              text not null,
  species           text not null default 'otro' check (species in ('perro','gato','otro')),
  age               text,
  description       text,
  image_url         text,
  contact_whatsapp  text,
  status            text not null default 'available' check (status in ('available','adopted')),
  created_at        timestamptz not null default now()
);
create index if not exists adoptions_by_status on adoptions (status, created_at desc);

do $$
begin
  execute 'alter table adoptions enable row level security';
  execute 'alter table adoptions force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'adoptions' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on adoptions using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;
