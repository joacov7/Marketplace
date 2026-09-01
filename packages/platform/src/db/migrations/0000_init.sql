-- F1 Fundaciones — backbone de tenancy + config + outbox, con AISLAMIENTO POR RLS (D4).
-- El aislamiento no depende de que el código recuerde el WHERE: Postgres niega las filas
-- de otros tenants aunque la query lo olvide. `app.tenant_id` lo setea withTenant() por
-- transacción; FORCE ROW LEVEL SECURITY hace que la política aplique INCLUSO al owner.

-- gen_random_uuid() es core desde Postgres 13 (Neon corre PG16); no requiere pgcrypto.

-- Registro de tenants (NO scopeado por tenant: es el índice de la plataforma).
create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  status     text not null default 'active',
  created_at timestamptz not null default now()
);

-- Regiones (ciudades). Ciudad = región dentro del tenant (D1).
create table if not exists regions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  slug       text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Comercios (commerce). En V1: el Pet Shop propio, modelado como commerce independiente.
create table if not exists merchants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  region_id  uuid references regions(id),
  slug       text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Config values (gestionados por la plataforma; filtrados por scope en la capa de
-- servicio, no por RLS de tenant, porque los de scope 'platform' son globales).
create table if not exists config_values (
  id             uuid primary key default gen_random_uuid(),
  key            text not null,
  scope_type     text not null check (scope_type in ('platform','tenant','region','merchant','user')),
  scope_id       text not null,
  value          jsonb not null,
  version        int  not null default 1,
  effective_from timestamptz not null default now(),
  actor          text not null,
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists config_values_lookup on config_values (key, scope_type, scope_id);

-- Outbox transaccional: el evento se escribe en la misma tx que el cambio de estado.
-- Es una tabla de INFRAESTRUCTURA drenada por un proceso de plataforma (cross-tenant),
-- por eso NO va bajo RLS de tenant (si lo estuviera, el drenaje no vería nada). El
-- `tenant_id` correcto lo garantiza la capa de app: enqueueEvent() se llama dentro de
-- withTenant() y toma el tenantId del contexto. Ningún código tenant-facing hace SELECT
-- sobre esta tabla.
create table if not exists outbox_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  type         text not null,
  version      int  not null default 1,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending','published')),
  occurred_at  timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists outbox_pending on outbox_events (status, occurred_at);

-- Rol de aplicación: la app NO debe conectarse como superusuario (los superusuarios
-- BYPASSean RLS). Conecta como `commerce_app`, que al no ser owner de las tablas queda
-- siempre sujeto a las políticas. En Neon: crear el rol de la app y darle estos grants.
do $$ begin
  begin
    if not exists (select from pg_roles where rolname = 'commerce_app') then
      create role commerce_app;
    end if;
    grant usage on schema public to commerce_app;
    grant select, insert, update, delete on all tables in schema public to commerce_app;
    alter default privileges in schema public grant select, insert, update, delete on tables to commerce_app;
  exception when insufficient_privilege then
    -- En Neon el rol de la app es el OWNER (no superusuario), así que FORCE ROW LEVEL
    -- SECURITY ya lo constriñe y no hace falta commerce_app. Si no hay privilegio para
    -- crearlo, seguimos: el aislamiento igual aplica.
    raise notice 'commerce_app no creado (sin privilegio); el rol owner + FORCE RLS alcanza';
  end;
end $$;

-- Helper: tenant actual desde la variable de sesión. NULL si no está seteada → deniega
-- todo (falla cerrado).
create or replace function current_tenant_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- Activar RLS en las tablas scopeadas por tenant.
do $$
declare t text;
begin
  foreach t in array array['regions','merchants'] loop
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
