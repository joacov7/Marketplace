-- Fotos de producto. Agrega image_url a products (URL http/https saneada en la capa de
-- app). Idempotente: add column if not exists. La imagen es a nivel producto (todas las
-- variantes comparten la foto principal en V1); si más adelante se quiere foto por
-- variante, se agrega variants.image_url sin romper esto.

alter table products add column if not exists image_url text;
