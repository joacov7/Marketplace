import { NextResponse } from "next/server";
import { getConfigKeyDef, resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Parámetros de negocio editables desde el panel (sin tocar código ni variables de entorno).
 * Cada clave DEBE existir en el registry de config (CONFIG_KEYS); el tipo de campo se deriva de
 * su jsonSchema y la escritura pasa por setConfigValue (valida por schema + audita las claves
 * sensibles). Los toggles de funciones de la tienda viven en "Diseño"; acá van los números y
 * reglas del negocio. Agregar un parámetro editable = sumar su clave a SECTIONS.
 */
const SECTIONS: Array<{ title: string; items: Array<{ key: string; label: string }> }> = [
  {
    title: "Envíos y reparto",
    items: [
      { key: "delivery.customerChargeMinor", label: "Costo de envío al cliente" },
      { key: "delivery.freeOverOrderTotalMinor", label: "Envío gratis a partir de" },
      { key: "delivery.minOrderMinor", label: "Mínimo de envío con alimento" },
      { key: "delivery.minOrderNoFoodMinor", label: "Mínimo de envío sin alimento (almacén)" },
      { key: "delivery.auxilioCostMinor", label: "Costo del Envío de Auxilio" },
      { key: "delivery.cadeteCostMinor", label: "Costo real de una entrega (cadete)" },
      { key: "delivery.subsidySource", label: "Quién financia el subsidio de envío" },
      { key: "features.auxilioDelivery", label: "Ofrecer Envío de Auxilio (nocturno)" },
    ],
  },
  {
    title: "Pagos y descuentos",
    items: [
      { key: "payments.transferDiscountPercent", label: "Descuento por transferencia (%)" },
      { key: "subscriptions.discountPercent", label: "Descuento en suscripciones (%)" },
    ],
  },
  {
    title: "Tienda",
    items: [
      { key: "storefront.featuredCount", label: "Productos destacados en la home" },
      { key: "storefront.listColumns", label: "Columnas del listado de productos" },
    ],
  },
  {
    title: "Funciones de la tienda",
    items: [
      { key: "features.aiAssistant", label: "Vendedor IA (asesora y recomienda del catálogo)" },
      { key: "features.subscriptions", label: "Suscripción de auto-envío (recompra automática)" },
      { key: "features.foodCalculator", label: "Calculadora de consumo + Mis mascotas" },
      { key: "features.foodComparator", label: "Comparador de alimentos (costo por día)" },
      { key: "features.quickReorder", label: "Compra rápida (repetir última compra)" },
      { key: "features.adoptions", label: "Sección de Adopciones / callejeritos" },
      { key: "features.contentStudio", label: "Estudio de Contenido (post del día para redes)" },
    ],
  },
];

const EDITABLE = new Set(SECTIONS.flatMap((s) => s.items.map((i) => i.key)));

type FieldType = "boolean" | "money" | "integer" | "select" | "text";
interface Field {
  key: string;
  label: string;
  help: string;
  type: FieldType;
  options?: unknown[];
  min?: number;
  max?: number;
  value: unknown;
}

/** Deriva el tipo de campo (y sus límites) del jsonSchema de la clave. money = entero en centavos. */
function fieldType(key: string): { type: FieldType; options?: unknown[]; min?: number; max?: number } {
  const def = getConfigKeyDef(key)!;
  const schema = def.jsonSchema as { type?: string; enum?: unknown[]; minimum?: number; maximum?: number };
  const range = { min: schema.minimum, max: schema.maximum };
  if (schema.type === "boolean") return { type: "boolean" };
  if (Array.isArray(schema.enum)) return { type: "select", options: schema.enum };
  if (def.category === "money" && /Minor$/.test(key)) return { type: "money", ...range };
  if (schema.type === "integer" || schema.type === "number") return { type: "integer", ...range };
  return { type: "text", ...range };
}

export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const sections = await Promise.all(
    SECTIONS.map(async (s) => ({
      title: s.title,
      fields: await Promise.all(
        s.items.map(async ({ key, label }): Promise<Field> => {
          const def = getConfigKeyDef(key)!;
          const value = (await resolveConfigValue<unknown>(db(), key, { tenantId: tenant.tenantId })).value;
          const { type, options, min, max } = fieldType(key);
          return { key, label, help: def.description ?? "", type, ...(options ? { options } : {}), ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), value };
        }),
      ),
    })),
  );
  return NextResponse.json({ sections });
}

export async function PATCH(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const applied: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE.has(key)) return NextResponse.json({ error: "unknown_key", key }, { status: 400 });
    const res = await setConfigValue(db(), {
      key,
      scopeType: "tenant",
      scopeId: tenant.tenantId,
      value,
      actor: "merchant-admin",
      reason: "settings-editor",
    });
    if (!res.ok) return NextResponse.json({ error: res.error, key }, { status: 400 });
    applied.push(key);
  }

  return NextResponse.json({ ok: true, applied });
}
