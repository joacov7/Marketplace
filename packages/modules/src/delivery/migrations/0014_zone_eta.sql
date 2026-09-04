-- Eslabón 3 (zonas de reparto). Tiempo estimado por zona, para mostrarlo al cliente y ordenar
-- la ruta del cadete. Solo DDL, idempotente. La tarifa por zona ya vive en delivery_rates.
alter table delivery_zones add column if not exists eta_minutes int;
