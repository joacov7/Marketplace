-- Imágenes subidas (fotos de productos y categorías) guardadas EN LA BASE, para no
-- depender de un almacenamiento externo ni de tokens. Es una tabla de ASSETS PÚBLICOS:
-- se sirven por una URL con UUID opaco (/api/images/<id>) y se muestran en la tienda
-- pública, donde el <img> no tiene contexto de tenant. Por eso —igual criterio que
-- outbox_events— NO va bajo RLS de tenant: la lectura es pública por id. La escritura la
-- protege el endpoint autenticado (token de admin + tenant); `tenant_id` queda para orden
-- y limpieza, no como frontera de aislamiento. Los bytes van ya comprimidos desde el cliente.
create table if not exists images (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  content_type text not null,
  data         bytea not null,
  byte_size    int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists images_tenant on images (tenant_id, created_at desc);
