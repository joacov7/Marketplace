import { resolveConfigSnapshot } from "@commerce/platform";
import { db } from "./db";
import { resolveTenant, type ResolvedTenant } from "./tenant";
import { cleanText, cssColor } from "./config-text";

export interface ShopLegal {
  tenant: ResolvedTenant;
  displayName: string;
  primary: string;
  whatsapp: string;
  businessName: string;
  taxId: string;
  address: string;
  email: string;
}

/** Datos del comercio para las páginas legales (arrepentimiento, términos). Null si no resuelve. */
export async function loadShopLegal(slug: string | undefined): Promise<ShopLegal | null> {
  const tenant = await resolveTenant(slug ?? null);
  if (!tenant) return null;
  const cfg = await resolveConfigSnapshot(db(), { tenantId: tenant.tenantId });
  const text = (key: string) => cleanText(cfg.get<string>(key), "");
  const displayName = cleanText(cfg.get<string>("branding.displayName"), tenant.name);
  return {
    tenant,
    displayName,
    primary: cssColor(cfg.get<string>("branding.primaryColor")),
    whatsapp: text("contact.whatsapp").replace(/\D+/g, ""),
    businessName: text("legal.businessName") || displayName,
    taxId: text("legal.taxId"),
    address: text("legal.address"),
    email: text("legal.email"),
  };
}
