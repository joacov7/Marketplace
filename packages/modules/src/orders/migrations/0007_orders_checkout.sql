-- Checkout completo: el pedido guarda la dirección de envío (snapshot), la ventana de
-- entrega elegida y el costo de delivery cobrado. Snapshot en jsonb para preservar la
-- dirección aunque el cliente la edite después.
alter table orders add column if not exists shipping_address jsonb;
alter table orders add column if not exists delivery_window text;
alter table orders add column if not exists delivery_charge_minor bigint not null default 0;
