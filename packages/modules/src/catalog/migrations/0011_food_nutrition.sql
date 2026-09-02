-- Datos nutricionales del alimento (para la calculadora de consumo y reposición).
-- kcal_per_kg y protein_pct van a nivel producto; net_weight_kg (peso neto de la bolsa)
-- a nivel variante (cada talle es una presentación con su peso). Todo nullable: un producto
-- que NO es alimento simplemente los deja en null. Idempotente.

alter table products add column if not exists kcal_per_kg  int;
alter table products add column if not exists protein_pct  numeric(4,1);
alter table variants add column if not exists net_weight_kg numeric(7,3);
