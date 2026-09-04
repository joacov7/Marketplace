-- Precio anterior / de lista por variante, para mostrar el badge de descuento y el precio
-- tachado en las cards de "Ofertas destacadas". Opcional: si es null o <= precio actual, no
-- se muestra oferta. Solo DDL, idempotente.
alter table variants add column if not exists list_price_minor bigint;
