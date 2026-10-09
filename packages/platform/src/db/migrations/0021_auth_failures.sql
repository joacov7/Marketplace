-- Contador de intentos FALLIDOS de autenticación (p. ej. PIN de reparto), compartido entre
-- todas las rutas e instancias serverless. Un contador en memoria no sirve en Vercel: cada
-- función/instancia tiene el suyo y un atacante lo esquiva repartiendo intentos.
-- Clave opaca (ej: "delivery-fail:ip:<tenant>:<ip>"); no guarda credenciales ni datos de
-- clientes. Es de plataforma (como outbox_events), sin RLS de tenant: el tenant va en la clave.
create table if not exists auth_failures (
  key       text primary key,
  count     int not null default 0,
  reset_at  timestamptz not null
);
create index if not exists auth_failures_reset on auth_failures (reset_at);
