import { NextResponse } from "next/server";
import { createWithdrawalRequest } from "@commerce/modules/orders";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { rateLimited, rule, LIMITS } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  invalid_name: "Escribí tu nombre.",
  invalid_contact: "Dejanos un teléfono o un email para contactarte.",
};

/**
 * Botón de arrepentimiento (público, sin registro). Guarda la solicitud y devuelve en el momento
 * el código de identificación. Límite por IP para que no lo usen para llenar la base.
 */
export async function POST(req: Request) {
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  let body: { name?: unknown; contact?: unknown; orderRef?: unknown; message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const limited = await rateLimited(
    [rule(`withdrawal:ip:${tenant.tenantId}:${clientIp(req)}`, LIMITS.withdrawalPerIp)],
    "Recibimos varias solicitudes seguidas desde acá. Esperá un rato o escribinos por WhatsApp.",
  );
  if (limited) return limited;

  const res = await db().withTenant(tenant.tenantId, (tx) =>
    createWithdrawalRequest(tx, { tenantId: tenant.tenantId, name: body.name, contact: body.contact, orderRef: body.orderRef, message: body.message }),
  );
  if (!res.ok) return NextResponse.json({ error: res.error, message: ERROR_MESSAGE[res.error] }, { status: 400 });
  return NextResponse.json({ code: res.value.code, createdAt: res.value.createdAt }, { status: 201 });
}
