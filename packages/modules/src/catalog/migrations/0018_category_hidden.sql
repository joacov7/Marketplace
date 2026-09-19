-- Permite ocultar una categoría de la vitrina sin borrarla ni sus productos. `hidden = true`
-- la saca del storefront (el comercio la sigue viendo y editando en el panel). El orden ya lo
-- da `position` (0009). Idempotente.
alter table categories add column if not exists hidden boolean not null default false;
