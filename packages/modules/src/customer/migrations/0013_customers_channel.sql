-- Eslabón 1 — Operatoria de venta. La MASCOTA es el centro: el cliente se identifica por
-- TELÉFONO (ficha reutilizable, sin obligar a registrarse) y el pedido guarda para quién es
-- (mascota), cómo se paga y por qué canal entró. Base del flywheel (recompra/reposición).
--
-- Solo DDL: en Neon la app corre como owner con FORCE RLS, así que durante la migración
-- current_tenant_id() es NULL y un backfill de datos (INSERT/UPDATE con policy) tocaría 0
-- filas. El backfill (ficha de cliente por usuario, estado de pago de pedidos ya pagados) se
-- hace en código, con contexto de tenant. Idempotente.

-- Ficha de cliente por tenant. El teléfono normalizado (solo dígitos) es la llave práctica.
-- Para un usuario registrado, su ficha usa id = users.id (determinista, creada on-demand en
-- código), de modo que mascotas/direcciones/pedidos ya existentes (customer_id = user id)
-- siguen siendo válidos sin migrar datos.
create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  phone      text,
  name       text,
  user_id    uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Un teléfono = un cliente por tenant (evita duplicados). Usuario = una ficha por tenant.
create unique index if not exists customers_by_phone on customers (tenant_id, phone) where phone is not null;
create unique index if not exists customers_by_user on customers (tenant_id, user_id) where user_id is not null;

do $$
begin
  execute 'alter table customers enable row level security';
  execute 'alter table customers force row level security';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'customers' and policyname = 'tenant_isolation') then
    execute 'create policy tenant_isolation on customers using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())';
  end if;
end $$;

-- Pedido: para quién es (mascota, con nombre-snapshot para historial/panel aunque luego se
-- borre la mascota), forma y estado de pago, y canal de origen.
alter table orders add column if not exists pet_id         uuid;
alter table orders add column if not exists pet_name       text;
alter table orders add column if not exists payment_method text;
alter table orders add column if not exists payment_status text not null default 'pendiente';
alter table orders add column if not exists channel        text not null default 'web';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
    alter table orders add constraint orders_payment_status_check check (payment_status in ('pendiente','pagado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_channel_check') then
    alter table orders add constraint orders_channel_check check (channel in ('web','whatsapp','telefono','mostrador'));
  end if;
end $$;
