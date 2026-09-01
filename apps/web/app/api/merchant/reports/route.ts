import { NextResponse } from "next/server";
import { salesSummary, topProducts, stockAlerts, salesByDay } from "@commerce/modules/reports";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Dashboard del comercio: resumen de ventas (GMV, comisión, payout, refunds), serie diaria,
 * top de productos y alertas de stock. Solo lectura; corre con contexto de tenant (RLS).
 * Gated por token de servicio (demo; RBAC de staff es el paso siguiente).
 */
export async function GET(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tenant = await resolveTenant(url.searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "14")));
  const threshold = Math.max(0, Number(url.searchParams.get("stockThreshold") ?? "5"));

  const data = await db().withTenant(tenant.tenantId, async (tx) => {
    const [summary, series, top, alerts] = await Promise.all([
      salesSummary(tx),
      salesByDay(tx, { days }),
      topProducts(tx, { limit: 10 }),
      stockAlerts(tx, { threshold }),
    ]);
    return { summary, series, top, alerts };
  });

  return NextResponse.json({
    summary: {
      paidOrders: data.summary.paidOrders,
      gmvMinor: data.summary.gmvMinor.toString(),
      deliveryRevenueMinor: data.summary.deliveryRevenueMinor.toString(),
      commissionMinor: data.summary.commissionMinor.toString(),
      merchantPayoutMinor: data.summary.merchantPayoutMinor.toString(),
      refundsMinor: data.summary.refundsMinor.toString(),
      avgTicketMinor: data.summary.avgTicketMinor.toString(),
    },
    series: data.series.map((r) => ({ day: r.day, orders: r.orders, gmvMinor: r.gmvMinor.toString() })),
    top: data.top.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      unitsSold: r.unitsSold,
      revenueMinor: r.revenueMinor.toString(),
    })),
    alerts: data.alerts.map((r) => ({
      variantId: r.variantId,
      productName: r.productName,
      variantName: r.variantName,
      available: r.available,
      reserved: r.reserved,
    })),
  });
}
