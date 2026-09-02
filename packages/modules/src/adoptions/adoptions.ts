import type { Db } from "@commerce/platform";

/**
 * Módulo Adopciones ("callejeritos"): publicaciones de mascotas en adopción. Tabla propia,
 * scopeada por tenant y bajo RLS (corre siempre dentro de withTenant). No toca dinero ni
 * pedidos — es una sección de comunidad de la tienda.
 */

export type Species = "perro" | "gato" | "otro";

export interface Adoption {
  id: string;
  name: string;
  species: Species;
  age: string | null;
  description: string | null;
  imageUrl: string | null;
  contactWhatsapp: string | null;
  status: "available" | "adopted";
  createdAt: string;
}

interface AdoptionRow {
  id: string;
  name: string;
  species: Species;
  age: string | null;
  description: string | null;
  image_url: string | null;
  contact_whatsapp: string | null;
  status: "available" | "adopted";
  created_at: string;
}

const map = (r: AdoptionRow): Adoption => ({
  id: r.id,
  name: r.name,
  species: r.species,
  age: r.age,
  description: r.description,
  imageUrl: r.image_url,
  contactWhatsapp: r.contact_whatsapp,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
});

export interface CreateAdoptionInput {
  tenantId: string;
  name: string;
  species?: Species;
  age?: string;
  description?: string;
  imageUrl?: string;
  contactWhatsapp?: string;
}

export async function createAdoption(db: Db, input: CreateAdoptionInput): Promise<{ id: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into adoptions (tenant_id, name, species, age, description, image_url, contact_whatsapp)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      input.tenantId,
      input.name,
      input.species ?? "otro",
      input.age ?? null,
      input.description ?? null,
      input.imageUrl ?? null,
      input.contactWhatsapp ?? null,
    ],
  );
  return { id: row!.id };
}

/** Publicaciones disponibles (vista pública de la tienda). */
export async function listAdoptions(db: Db, opts: { limit?: number } = {}): Promise<Adoption[]> {
  const rows = await db.query<AdoptionRow>(
    `select * from adoptions where status = 'available' order by created_at desc limit $1`,
    [opts.limit ?? 60],
  );
  return rows.map(map);
}

/** Todas las publicaciones (panel del comercio), incluidas las ya adoptadas. */
export async function listAdoptionsAdmin(db: Db, opts: { limit?: number } = {}): Promise<Adoption[]> {
  const rows = await db.query<AdoptionRow>(
    `select * from adoptions order by (status = 'available') desc, created_at desc limit $1`,
    [opts.limit ?? 200],
  );
  return rows.map(map);
}

/** Actualiza campos de una publicación (solo los provistos). */
export async function updateAdoption(
  db: Db,
  input: { id: string; name?: string; species?: Species; age?: string | null; description?: string | null; imageUrl?: string | null; contactWhatsapp?: string | null; status?: "available" | "adopted" },
): Promise<void> {
  const cols: Record<string, unknown> = {
    name: input.name,
    species: input.species,
    age: input.age,
    description: input.description,
    image_url: input.imageUrl,
    contact_whatsapp: input.contactWhatsapp,
    status: input.status,
  };
  const sets: string[] = [];
  const params: unknown[] = [input.id];
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { params.push(val); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  await db.query(`update adoptions set ${sets.join(", ")} where id = $1`, params);
}

export async function deleteAdoption(db: Db, id: string): Promise<void> {
  await db.query(`delete from adoptions where id = $1`, [id]);
}
