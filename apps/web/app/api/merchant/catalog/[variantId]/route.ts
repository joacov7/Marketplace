import { NextResponse } from "next/server";
import { setPrice, setListPrice, setProductImageByVariant, setProductCategoryByVariant, setProductDescriptionByVariant, setFoodNutritionByVariant, setVariantNetWeight } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Actualiza precio, stock y/o foto de una variante. */
export async function PATCH(req: Request, { params }: { params: { variantId: string } }) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { priceMinor?: string | number; listPriceMinor?: string | number | null; stock?: number; imageUrl?: string; categoryId?: string | null; description?: string; kcalPerKg?: number | null; proteinPct?: number | null; netWeightKg?: number | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const numOrNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

  await db().withTenant(tenant.tenantId, async (tx) => {
    if (body.priceMinor !== undefined) {
      await setPrice(tx, { tenantId: tenant.tenantId, variantId: params.variantId, amountMinor: BigInt(body.priceMinor!) });
    }
    if (body.listPriceMinor !== undefined) {
      const lp = body.listPriceMinor === null || body.listPriceMinor === "" ? null : BigInt(Math.round(Number(body.listPriceMinor)));
      await setListPrice(tx, { tenantId: tenant.tenantId, variantId: params.variantId, listPriceMinor: lp && lp > 0n ? lp : null });
    }
    if (body.stock !== undefined) {
      await setStock(tx, { tenantId: tenant.tenantId, variantId: params.variantId, available: Number(body.stock) });
    }
    if (body.imageUrl !== undefined) {
      const clean = safeUrl(body.imageUrl);
      await setProductImageByVariant(tx, { tenantId: tenant.tenantId, variantId: params.variantId, imageUrl: clean || null });
    }
    if (body.categoryId !== undefined) {
      await setProductCategoryByVariant(tx, { tenantId: tenant.tenantId, variantId: params.variantId, categoryId: body.categoryId || null });
    }
    if (body.description !== undefined) {
      await setProductDescriptionByVariant(tx, { tenantId: tenant.tenantId, variantId: params.variantId, description: body.description.trim() || null });
    }
    if (body.kcalPerKg !== undefined || body.proteinPct !== undefined) {
      await setFoodNutritionByVariant(tx, { tenantId: tenant.tenantId, variantId: params.variantId, kcalPerKg: numOrNull(body.kcalPerKg), proteinPct: numOrNull(body.proteinPct) });
    }
    if (body.netWeightKg !== undefined) {
      await setVariantNetWeight(tx, { tenantId: tenant.tenantId, variantId: params.variantId, netWeightKg: numOrNull(body.netWeightKg) });
    }
  });
  return NextResponse.json({ ok: true });
}
