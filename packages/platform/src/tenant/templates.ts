/**
 * Plantilla de vertical: un conjunto de DEFAULTS de config + módulos habilitados. Crear
 * un tenant = crear las filas + aplicar una plantilla; NO hay código por cliente/ciudad
 * (regla del brief, criterio de aceptación "crear un segundo tenant sin tocar código").
 *
 * El core de comercio es agnóstico; lo específico del vertical (Pet: mascotas, recompra)
 * vive en su módulo, activado por `enabledModules` (D10/[A3]). Una ferretería sería otra
 * plantilla, sin tocar el core.
 */
export interface VerticalTemplate {
  id: string;
  vertical: string;
  /** Valores por defecto que la plantilla siembra en scope=tenant al provisionar. */
  configDefaults: ReadonlyArray<{ key: string; value: unknown }>;
  /** Módulos que quedan habilitados para el tenant. */
  enabledModules: readonly string[];
}

/** Plantilla del primer vertical: Pet Shop (V1). Todos los valores son overridables. */
export const PET_SHOP_TEMPLATE: VerticalTemplate = {
  id: "pet-shop-v1",
  vertical: "pet_shop",
  configDefaults: [
    { key: "commission.rateBps", value: 700 }, // 7% (L4)
    { key: "delivery.customerChargeMinor", value: 150000 }, // $1.500
    { key: "delivery.freeOverOrderTotalMinor", value: 5000000 }, // gratis > $50.000
    { key: "delivery.subsidySource", value: "platform" },
    { key: "orders.maxSellersPerOrder", value: 1 }, // V1: 1 pedido = 1 comercio (config)
    { key: "features.customerAgent", value: true },
    { key: "features.loyalty", value: false },
    { key: "branding.displayName", value: "Pet Shop" },
    { key: "branding.primaryColor", value: "#2563eb" },
  ],
  enabledModules: [
    "catalog",
    "inventory",
    "cart",
    "orders",
    "payments",
    "delivery",
    "promotions",
    "customer",
    "pet", // módulo de vertical
  ],
};

export const TEMPLATES: Record<string, VerticalTemplate> = {
  [PET_SHOP_TEMPLATE.id]: PET_SHOP_TEMPLATE,
};
