import { NextResponse } from "next/server";
import { resetPanelPassword, PANEL_ROLES, clearFailures } from "@commerce/platform";
import { db } from "@/lib/db";
import { consumeEmailToken } from "@/lib/auth-email";
import { loginRules, rateLimited, rule } from "@/lib/abuse";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await rateLimited([rule(`password-reset-confirm:ip:${clientIp(req)}`, { limit: 10, windowMs: 60 * 60_000 })], "Demasiados intentos. Esperá un rato y volvé a intentar.");
  if (limited) return limited;
  let body: { token?: string; newPassword?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.token || !body.newPassword || body.newPassword.length < 8) {
    return NextResponse.json({ error: "El enlace o la contraseña no son válidos." }, { status: 400 });
  }
  const outcome = await db().tx(async (tx) => {
    const grant = await consumeEmailToken(tx, body.token!, "password_reset");
    if (!grant) return { grant: null, ok: false };
    await tx.query("select set_config('app.tenant_id', $1, true)", [grant.tenant_id]);
    const result = await resetPanelPassword(tx, { email: grant.email, newPassword: body.newPassword!, adminRoles: PANEL_ROLES });
    return { grant, ok: result.ok };
  });
  if (!outcome.grant || !outcome.ok) return NextResponse.json({ error: "El enlace venció, ya fue utilizado o no se pudo actualizar la contraseña. Solicitá uno nuevo." }, { status: 400 });
  const grant = outcome.grant;

  const keys = loginRules(grant.tenant_id, clientIp(req), grant.email)
    .filter((r) => r.key.startsWith("login-fail:email:")).map((r) => r.key);
  if (keys.length) await clearFailures(db(), keys).catch(() => {});
  return NextResponse.json({ ok: true });
}
