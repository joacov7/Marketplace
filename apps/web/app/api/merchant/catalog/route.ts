import { NextResponse } from "next/server";
import { createProduct, addVariant, setPrice, listCatalogAdmin } from "@commerce/modules/catalog";
import { setStock } from "@commerce/modules/inventory";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";
import { safeUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Catálogo de un comercio (vista admin: con stock e inactivos). */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });
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
      priceMinor: r.priceMinor !== null ? r.priceMinor.toString() : null,
      currency: r.currency,
      available: r.available,
      status: r.productStatus,
    })),
  });
}

/** Carga un producto (producto + variante + precio + stock) en un comercio. */
export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { merchantId?: string; productName?: string; variantName?: string; sku?: string; priceMinor?: string | number; stock?: number; imageUrl?: string; categoryId?: string };
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
