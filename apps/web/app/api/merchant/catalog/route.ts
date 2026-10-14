import { NextResponse } from "next/server";
import { createProduct, addVariant, setPrice, listCatalogAdmin } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Catálogo de un comercio (vista admin: con stock e inactivos). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const url = new URL(req.url);
  const merchantId = url.searchParams.get("merchantId");
  if (!merchantId) return NextResponse.json({ error: "missing_merchantId" }, { status: 400 });

  const rows = await db().withTenant(tenant.tenantId, (tx) => listCatalogAdmin(tx, merchantId));
  return NextResponse.json({
    items: rows.map((r) => ({
      variantId: r.variantId,
      productName: r.productName,
      variantName: r.variantName,
      sku: r.sku,
      imageUrl: r.imageUrl,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      description: r.description,
      kcalPerKg: r.kcalPerKg,
      proteinPct: r.proteinPct,
      netWeightKg: r.netWeightKg,
      priceMinor: r.priceMinor !== null ? r.priceMinor.toString() : null,
      listPriceMinor: r.listPriceMinor !== null ? r.listPriceMinor.toString() : null,
      currency: r.currency,
      available: r.available,
      status: r.productStatus,
    })),
  });
}

/** Carga un producto (producto + variante + precio + stock) en un comercio. */
export async function POST(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { merchantId?: string; productName?: string; variantName?: string; sku?: string; priceMinor?: string | number; stock?: number; imageUrl?: string; categoryId?: string; description?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.merchantId || !body.productName || !body.sku || body.priceMinor === undefined) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const imageUrl = safeUrl(body.imageUrl);

  const slug =
    body.productName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 7);

  try {
    const result = await db().withTenant(tenant.tenantId, async (tx) => {
      const { productId } = await createProduct(tx, {
        tenantId: tenant.tenantId,
        merchantId: body.merchantId!,
        slug,
        name: body.productName!,
        ...(imageUrl ? { imageUrl } : {}),
        ...(body.categoryId ? { categoryId: body.categoryId } : {}),
        ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      });
      const { variantId } = await addVariant(tx, {
        tenantId: tenant.tenantId,
        productId,
        sku: body.sku!,
        name: body.variantName || "Único",
      });
      await setPrice(tx, { tenantId: tenant.tenantId, variantId, amountMinor: BigInt(body.priceMinor!) });
      await setStock(tx, { tenantId: tenant.tenantId, variantId, available: Number(body.stock ?? 0) });
      return { productId, variantId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
