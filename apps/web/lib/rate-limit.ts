/**
 * Rate limiter en memoria (ventana fija por clave). Best-effort: en serverless multi-instancia
 * el contador es por instancia, no global — mitiga el scraping masivo (p. ej. enumerar teléfonos
 * en /api/customer/lookup para cosechar nombres + mascotas), no lo elimina del todo. Suficiente
 * para F1 sin dependencias. Cuando haya volumen, reemplazar por un store compartido (Upstash/Redis)
 * detrás de esta misma función.
 */
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();
let lastPurge = 0;

/** Purga perezosa de buckets vencidos para que el Map no crezca sin límite. */
function purge(now: number): void {
  if (now - lastPurge < 60_000) return;
  lastPurge = now;
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}

/**
 * Consume 1 del cupo de `key`. Devuelve `ok:false` cuando se superó `limit` dentro de `windowMs`.
 * `retryAfterMs` indica cuánto falta para que se reinicie la ventana.
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  purge(now);
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfterMs: b.resetAt - now };
  return { ok: true, retryAfterMs: 0 };
}

/** IP del cliente detrás del proxy de Vercel (x-forwarded-for), con fallbacks. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
