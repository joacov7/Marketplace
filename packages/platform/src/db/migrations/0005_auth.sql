-- Auth (Grupo A). Usuarios y roles scopeados por tenant, bajo RLS. El hash de password
-- se guarda como texto (scrypt); nunca la contraseña en claro. Depende de 0000_init.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  email         text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists user_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  user_id    uuid not null references users(id),
  role       text not null,
  scope_type text not null check (scope_type in ('tenant','region','merchant')),
  scope_id   text not null,
  created_at timestamptz not null default now()
);
create index if not exists user_roles_by_user on user_roles (user_id);

do $$
declare t text;
begin
  foreach t in array array['users','user_roles'] loop
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
