import type { Db } from "@commerce/platform";

// ── Ficha de cliente por teléfono ────────────────────────────────────────────────
// El teléfono es la llave práctica para reconocer al cliente sin obligarlo a registrarse.
// Base del flywheel: identificar al cliente + su mascota habilita recompra/reposición.

export interface Customer {
  id: string;
  phone: string | null;
  name: string | null;
  userId: string | null;
}
interface CustomerRow {
  id: string;
  phone: string | null;
  name: string | null;
  user_id: string | null;
}
const mapCustomer = (r: CustomerRow): Customer => ({ id: r.id, phone: r.phone, name: r.name, userId: r.user_id });

/**
 * Normaliza un teléfono a solo dígitos (descarta espacios, guiones, paréntesis y el `+`).
 * Devuelve "" si no queda ningún dígito. Sirve para deduplicar la ficha del cliente: dos
 * formas de escribir el mismo número ("2447 15-40-40" y "244715 4040") caen en la misma llave.
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

/** Busca la ficha de un cliente por teléfono normalizado (con contexto de tenant). */
export async function findCustomerByPhone(db: Db, phone: string): Promise<Customer | null> {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  const [row] = await db.query<CustomerRow>(
    `select id, phone, name, user_id from customers where phone = $1 limit 1`,
    [norm],
  );
  return row ? mapCustomer(row) : null;
}

/**
 * Encuentra o crea la ficha del cliente por teléfono. Idempotente: si el teléfono ya existe
 * en el tenant reutiliza la ficha (y completa el nombre si estaba vacío). No duplica.
 */
export async function findOrCreateCustomerByPhone(
  db: Db,
  input: { tenantId: string; phone: string; name?: string },
): Promise<{ customerId: string; created: boolean; customer: Customer }> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("invalid_phone");
  const existing = await findCustomerByPhone(db, phone);
  if (existing) {
    // Completar el nombre si la ficha no lo tenía y ahora lo pasan (sin pisar el existente).
    if (!existing.name && input.name?.trim()) {
      await db.query(`update customers set name = $2, updated_at = now() where id = $1`, [existing.id, input.name.trim()]);
      existing.name = input.name.trim();
    }
    return { customerId: existing.id, created: false, customer: existing };
  }
  const [row] = await db.query<CustomerRow>(
    `insert into customers (tenant_id, phone, name) values ($1,$2,$3)
     on conflict (tenant_id, phone) where phone is not null do update set updated_at = now()
     returning id, phone, name, user_id`,
    [input.tenantId, phone, input.name?.trim() ?? null],
  );
  return { customerId: row!.id, created: true, customer: mapCustomer(row!) };
}

/**
 * Garantiza la ficha de cliente de un usuario registrado. Determinista: id = userId, de modo
 * que las mascotas/direcciones/pedidos ya guardados con customer_id = user id siguen siendo
 * válidos. Idempotente. Devuelve el customerId (== userId).
 */
export async function ensureCustomerForUser(
  db: Db,
  input: { tenantId: string; userId: string; name?: string; phone?: string },
): Promise<{ customerId: string }> {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  await db.query(
    `insert into customers (id, tenant_id, user_id, name, phone) values ($1,$2,$1,$3,$4)
     on conflict (id) do update set
       name = coalesce(customers.name, excluded.name),
       phone = coalesce(customers.phone, excluded.phone),
       updated_at = now()`,
    [input.userId, input.tenantId, input.name?.trim() ?? null, phone || null],
  );
  return { customerId: input.userId };
}

export async function getCustomer(db: Db, customerId: string): Promise<Customer | null> {
  const [row] = await db.query<CustomerRow>(`select id, phone, name, user_id from customers where id = $1`, [customerId]);
  return row ? mapCustomer(row) : null;
}

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
