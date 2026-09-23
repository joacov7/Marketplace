-- Combos / Cajas: un bundle con nombre propio que agrupa varios productos del catálogo con
-- su cantidad, para que el cliente sume todo de un clic (ej. "Caja limpieza del mes"). Sirve
-- para llegar al mínimo de envío y subir el ticket sin buscar producto por producto. El precio
-- del combo es la suma de sus ítems al precio vigente (no re-precia el checkout): el descuento,
-- si lo hay, se hace poniendo los productos en oferta. Por comercio, bajo RLS. Idempotente.

create table if not exists combos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  merchant_id uuid not null references merchants(id),
  name        text not null,
  description text,
  image_url   text,
  active      boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists combos_by_merchant on combos (merchant_id, position, created_at);

create table if not exists combo_items (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  combo_id   uuid not null references combos(id) on delete cascade,
  variant_id uuid not null references variants(id),
  qty        int not null default 1 check (qty > 0)
);
create index if not exists combo_items_by_combo on combo_items (combo_id);

do $$
declare t text;
begin
  foreach t in array array['combos','combo_items'] loop
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
