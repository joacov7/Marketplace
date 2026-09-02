-- Categorías de producto (Perros, Gatos, Accesorios, Higiene, …). Por comercio, bajo RLS.
-- Un producto pertenece a 0 o 1 categoría (V1). Idempotente. `position` ordena las
-- categorías en la vitrina; `image_url` es la foto de la ficha de categoría (saneada en app).

create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  merchant_id uuid not null references merchants(id),
  slug        text not null,
  name        text not null,
  image_url   text,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique (merchant_id, slug)
);
create index if not exists categories_by_merchant on categories (merchant_id, position);

-- Un producto puede estar en una categoría (nullable: productos sin categoría siguen válidos).
alter table products add column if not exists category_id uuid references categories(id);

do $$
begin
  execute 'alter table categories enable row level security';
  execute 'alter table categories force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on categories using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;
