-- Repara columnas jsonb que el driver de producción (postgres.js) guardó DOBLE-CODIFICADAS:
-- en vez del objeto {"street": ...} quedó un string JSON con ese texto adentro. Efecto: la
-- pantalla de reparto mostraba "Sin dirección" (shipping_address->>'street' = null).
-- El código ya escribe con `$n::text::jsonb` (no vuelve a pasar); acá se arreglan las filas viejas.
--
-- Solo se tocan filas cuyo valor es un STRING JSON que contiene un OBJETO JSON válido; todo lo
-- demás (filas sanas, nulls, texto que no es JSON) queda igual. Idempotente: corrida dos veces
-- no cambia nada más.
--
-- orders y delivery_events tienen FORCE ROW LEVEL SECURITY: el dueño de las tablas también
-- queda sujeto a la política, así que se recorre tenant por tenant fijando app.tenant_id.
-- config_values NO se reescribe: es historial versionado y su tipo depende de cada clave; la
-- lectura lo convierte según el tipo declarado (config/repository.ts).

do $$
declare
  t record;
  r record;
  parsed jsonb;
begin
  -- Tablas bajo RLS: tenant por tenant.
  for t in select id from tenants loop
    perform set_config('app.tenant_id', t.id::text, true);

    for r in select id, shipping_address as v from orders where jsonb_typeof(shipping_address) = 'string' loop
      begin
        parsed := (r.v #>> '{}')::jsonb;
        if jsonb_typeof(parsed) = 'object' then
          update orders set shipping_address = parsed where id = r.id;
        end if;
      exception when others then null; -- no es JSON: se deja como está
      end;
    end loop;

    for r in select id, data as v from delivery_events where jsonb_typeof(data) = 'string' loop
      begin
        parsed := (r.v #>> '{}')::jsonb;
        if jsonb_typeof(parsed) = 'object' then
          update delivery_events set data = parsed where id = r.id;
        end if;
      exception when others then null;
      end;
    end loop;
  end loop;
  perform set_config('app.tenant_id', '', true);

  -- outbox_events no tiene RLS (tabla de plataforma).
  for r in select id, payload as v from outbox_events where jsonb_typeof(payload) = 'string' loop
    begin
      parsed := (r.v #>> '{}')::jsonb;
      if jsonb_typeof(parsed) = 'object' then
        update outbox_events set payload = parsed where id = r.id;
      end if;
    exception when others then null;
    end;
  end loop;
end $$;
