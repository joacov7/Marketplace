import { NextResponse } from "next/server";
import { resolveConfigValue, setConfigValue } from "@commerce/platform";
import { db } from "@/lib/db";
import { panelTenant } from "@/lib/auth";
import { DELIVERY_PIN_MIN_LENGTH } from "@/lib/delivery-access";

export const dynamic = "force-dynamic";

/** Lee el PIN de reparto actual del tenant (para mostrarlo/editarlo en el panel). */
export async function GET(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;
  const pin = (await resolveConfigValue<string>(db(), "ops.deliveryPin", { tenantId: tenant.tenantId })).value;
  // `tooShort`: PIN cargado antes de exigir el mínimo; ya no abre reparto hasta cambiarlo.
  const value = typeof pin === "string" ? pin : "";
  return NextResponse.json({ pin: value, tooShort: value.length > 0 && value.length < DELIVERY_PIN_MIN_LENGTH });
}

/** Define (o borra con "") el PIN de reparto del tenant. */
export async function PATCH(req: Request) {
  const panel = await panelTenant(req);
  if ("error" in panel) return panel.error;
  const { tenant } = panel;

  let body: { pin?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const pin = (body.pin ?? "").trim();
  if (pin && pin.length < DELIVERY_PIN_MIN_LENGTH) {
    return NextResponse.json(
      { error: `El PIN tiene que tener al menos ${DELIVERY_PIN_MIN_LENGTH} caracteres.` },
      { status: 400 },
    );
  }

  const res = await setConfigValue(db(), {
    key: "ops.deliveryPin",
    scopeType: "tenant",
    scopeId: tenant.tenantId,
    value: pin,
    actor: "merchant-admin",
    reason: "set-delivery-pin",
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, pin });
}
