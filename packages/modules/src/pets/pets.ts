import type { Db } from "@commerce/platform";

/**
 * Módulo Pets: perfiles de mascota del cliente + calculadora de consumo de alimento.
 * Tabla propia bajo RLS (corre dentro de withTenant). La calculadora es PURA: usa la fórmula
 * veterinaria estándar RER/MER y la densidad energética del alimento (kcal/kg). No toca dinero.
 */

export type Species = "perro" | "gato" | "otro";

/** Etapa/actividad → factor de mantenimiento (× RER). Editable por config (nutrition.factors). */
export const DEFAULT_FACTORS: Record<string, number> = {
  cachorro: 2.0,
  adulto_bajo: 1.2, // poco activo / castrado
  adulto_normal: 1.4,
  adulto_activo: 1.6,
  senior: 1.2,
};

export const ACTIVITY_LABEL: Record<string, string> = {
  cachorro: "Cachorro",
  adulto_bajo: "Adulto poco activo / castrado",
  adulto_normal: "Adulto normal",
  adulto_activo: "Adulto activo",
  senior: "Senior",
};

/** Requerimiento energético en reposo (kcal/día): 70 × peso^0.75. */
export function restingEnergy(weightKg: number): number {
  if (!(weightKg > 0)) return 0;
  return 70 * Math.pow(weightKg, 0.75);
}

export interface ConsumptionInput {
  weightKg: number;
  factor: number; // factor de mantenimiento (de la etapa/actividad)
  kcalPerKg: number; // densidad energética del alimento
}
export interface Consumption {
  merKcalPerDay: number; // energía diaria requerida
  gramsPerDay: number; // gramos de ESTE alimento por día
  kgPerMonth: number; // kg por mes (30 días)
}

/** Calcula el consumo diario/mensual de un alimento para una mascota. Puro. */
export function estimateConsumption(input: ConsumptionInput): Consumption {
  const mer = input.factor * restingEnergy(input.weightKg);
  const kcalPerGram = input.kcalPerKg > 0 ? input.kcalPerKg / 1000 : 0;
  const gramsPerDay = kcalPerGram > 0 ? mer / kcalPerGram : 0;
  return {
    merKcalPerDay: Math.round(mer),
    gramsPerDay: Math.round(gramsPerDay),
    kgPerMonth: Math.round((gramsPerDay * 30) / 100) / 10, // 1 decimal
  };
}

/** Cuántos días rinde una bolsa de `netKg` para el consumo dado (0 si no computa). */
export function daysForBag(netKg: number, gramsPerDay: number): number {
  if (!(netKg > 0) || !(gramsPerDay > 0)) return 0;
  return Math.floor((netKg * 1000) / gramsPerDay);
}

export function factorFor(activity: string, factors: Record<string, number> = DEFAULT_FACTORS): number {
  return factors[activity] ?? DEFAULT_FACTORS[activity] ?? DEFAULT_FACTORS.adulto_normal!;
}

// ── CRUD de mascotas ─────────────────────────────────────────────────────────────
export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  weightKg: number | null;
  activity: string;
  createdAt: string;
}
interface PetRow {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  weight_kg: string | null;
  activity: string;
  created_at: string;
}
const map = (r: PetRow): Pet => ({
  id: r.id,
  name: r.name,
  species: r.species,
  breed: r.breed,
  weightKg: r.weight_kg !== null ? Number(r.weight_kg) : null,
  activity: r.activity,
  createdAt: new Date(r.created_at).toISOString(),
});

export async function createPet(
  db: Db,
  input: { tenantId: string; customerId: string; name: string; species?: Species; breed?: string; weightKg?: number; activity?: string },
): Promise<{ id: string }> {
  const [row] = await db.query<{ id: string }>(
    `insert into pets (tenant_id, customer_id, name, species, breed, weight_kg, activity)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [
      input.tenantId,
      input.customerId,
      input.name,
      input.species ?? "perro",
      input.breed ?? null,
      input.weightKg ?? null,
      input.activity ?? "adulto_normal",
    ],
  );
  return { id: row!.id };
}

export async function listPets(db: Db, customerId: string): Promise<Pet[]> {
  const rows = await db.query<PetRow>(`select * from pets where customer_id = $1 order by created_at`, [customerId]);
  return rows.map(map);
}

export async function updatePet(
  db: Db,
  input: { id: string; customerId: string; name?: string; species?: Species; breed?: string | null; weightKg?: number | null; activity?: string },
): Promise<void> {
  const cols: Record<string, unknown> = {
    name: input.name,
    species: input.species,
    breed: input.breed,
    weight_kg: input.weightKg,
    activity: input.activity,
  };
  const sets: string[] = [];
  const params: unknown[] = [input.id, input.customerId];
  for (const [col, val] of Object.entries(cols)) {
    if (val !== undefined) { params.push(val); sets.push(`${col} = $${params.length}`); }
  }
  if (sets.length === 0) return;
  await db.query(`update pets set ${sets.join(", ")} where id = $1 and customer_id = $2`, params);
}

export async function deletePet(db: Db, id: string, customerId: string): Promise<void> {
  await db.query(`delete from pets where id = $1 and customer_id = $2`, [id, customerId]);
}
