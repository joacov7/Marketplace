import type { Db } from "@commerce/platform";

export interface AddressInput {
  tenantId: string;
  customerId: string;
  label?: string;
  street: string;
  city?: string;
  zone?: string;
  notes?: string;
}

export interface Address {
  id: string;
  label: string | null;
  street: string;
  city: string | null;
  zone: string | null;
  notes: string | null;
}

/** Guarda una dirección en la libreta del cliente (correr con contexto de tenant). */
export async function addAddress(db: Db, input: AddressInput): Promise<{ addressId: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into addresses (tenant_id, customer_id, label, street, city, zone, notes)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [input.tenantId, input.customerId, input.label ?? null, input.street, input.city ?? null, input.zone ?? null, input.notes ?? null],
  );
  return { addressId: row!.id };
}

export async function listAddresses(db: Db, customerId: string): Promise<Address[]> {
  const rows = await db.query<{ id: string; label: string | null; street: string; city: string | null; zone: string | null; notes: string | null }>(
    `select id, label, street, city, zone, notes from addresses where customer_id = $1 order by created_at desc`,
    [customerId],
  );
  return rows.map((r) => ({ id: r.id, label: r.label, street: r.street, city: r.city, zone: r.zone, notes: r.notes }));
}
