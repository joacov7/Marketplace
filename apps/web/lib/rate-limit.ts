/**
 * IP del cliente para los límites contra abuso (lib/abuse.ts, lib/delivery-access.ts). Los
 * contadores viven en Postgres (compartidos entre rutas e instancias); un contador en memoria
 * no sirve en serverless.
 */
/** IP del cliente detrás del proxy de Vercel (x-forwarded-for), con fallbacks. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
