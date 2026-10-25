import { NextResponse } from "next/server";
import { findCustomerByPhone } from "@commerce/modules/customer";
import { loyaltyBalance, loyaltyHistory } from "@commerce/modules/loyalty";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Panel: busca un cliente por teléfono y devuelve su saldo de puntos e historial. */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  const phone = new URL(req.url).searchParams.get("phone") ?? "";
  if (phone.replace(/\D+/g, "").length < 6) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const data = await db().withTenant(tenant.tenantId, async (tx) => {
    const c = await findCustomerByPhone(tx, phone);
    if (!c) return null;
    return { customer: c, balance: await loyaltyBalance(tx, c.id), history: await loyaltyHistory(tx, c.id, 30) };
  });
  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    customer: { id: data.customer.id, name: data.customer.name, phone: data.customer.phone },
    balance: data.balance,
    history: data.history,
  });
}
