/**
 * Deriva el slug del tenant desde el Host (subdominio) o un override de header (dev).
 * Pura y sin dependencias de Next → testeable en aislamiento. NUNCA se toma el tenant de
 * un parámetro que el cliente pueda falsear en el body.
 */
export function tenantSlugFromHost(host: string | null, override: string | null): string | null {
  if (override) return override;
  if (!host) return null;
  const hostname = host.split(":")[0]!;
  const parts = hostname.split(".");
  // Sin subdominio (localhost, dominio raíz de dos labels) → sin tenant.
  if (parts.length < 3 && !hostname.endsWith(".localhost")) return null;
  const slug = parts[0]!;
  if (!slug || slug === "www") return null;
  return slug;
}
