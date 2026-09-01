# Commerce OS

White Label **Multi-Tenant Commerce OS**. Core agnóstico de vertical,
*configuration-first*, multi-tenant con **aislamiento por RLS**. Arranca como Pet Shop
propio y evoluciona a marketplace / White Label / multi-vertical **sin rehacer el core**.

- **Diseño (Fase 0):** [`docs/fase-0/`](docs/fase-0/) — auditoría, decisiones, arquitectura,
  ERD, flujos, modelo económico. Empezá por [`docs/fase-0/11-cierre.md`](docs/fase-0/11-cierre.md).
- **Deploy:** full-stack **Next.js en Vercel** + **Neon** (Postgres) + **Upstash** (Redis/cola).
- **Agent Core:** repo separado, integrado in-process como SDK (no se toca desde acá).

## Estado: Fase 1 — F1 (Fundaciones) en curso

Cimiento de todo lo demás. Ya implementado y testeado:

| Pieza | Qué hace | Dónde |
|-------|----------|-------|
| **Port de DB** | Los módulos dependen de `Db`/`TenantAwareDb`, no del driver. Adaptador postgres.js (Neon, prod) y PGlite (tests). | `packages/platform/src/db/port.ts`, `pg.ts` |
| **Aislamiento multi-tenant (RLS)** | Postgres niega filas de otros tenants aunque el código olvide el `WHERE`. `withTenant()` setea `app.tenant_id` por transacción. **Probado sobre Postgres real.** | `packages/platform/src/db/` |
| **Configuration Engine** | Resolución por herencia (platform→tenant→region→merchant→user), versionado, effective-dating, validación por JSON Schema. Registro tipado de claves + **repositorio** (persistencia). | `packages/platform/src/config/` |
| **Provisioning de tenant** | `createTenant()` crea tenant + región y aplica una **plantilla de vertical** (Pet Shop) — todo por datos, cero código por tenant. | `packages/platform/src/tenant/` |
| **RBAC scopeado** | Permisos verbo:recurso con contención por scope; sin cruce entre tenants; flag de MFA | `packages/platform/src/rbac/` |
| **Money** | Aritmética en centavos (nunca float) + `allocate` que reparte sin perder centavos (PaymentAllocation) | `packages/platform/src/money/` |
| **Outbox transaccional** | Evento en la misma tx que el cambio de estado; drenado por Cron/QStash | `packages/platform/src/outbox/` |
| **Contracts** | Tipos canónicos sin lógica (Money, TenantContext, Config, RBAC, Event) | `packages/contracts/` |

**37 tests** (35 verdes + 2 gated a Neon). Pendiente de F1: app **Next.js** (BFF + route
handlers con resolución de tenant en el borde), **Identity/auth + MFA**.

### F2 — Catálogo + Inventario ✅

| Pieza | Qué hace | Dónde |
|-------|----------|-------|
| **Catálogo** | Productos, variantes y precios versionados (precio actual = último vigente; base para re-cotizar recompras) | `packages/modules/src/catalog/` |
| **Inventario + reserva atómica** | Guard anti-oversell ([G1]): decremento condicional `available >= qty`; ciclo reserve(TTL)→confirm/release; barrido de vencidas por cron. **Probado.** | `packages/modules/src/inventory/` |

**46 tests** en total (44 verdes + 2 gated a Neon). Los módulos de dominio viven en
`@commerce/modules`, dueños de sus tablas (migración `0001_catalog_inventory.sql`).

### F3 — Orders (parte 1) ✅

| Pieza | Qué hace | Dónde |
|-------|----------|-------|
| **Modelo Order/SellerOrder/OrderItem** | Items cuelgan de seller_order → multi-seller = N seller_orders, **sin rehacer Order** ([E1]). Todo bajo RLS. | `orders/migrations/0002_orders.sql` |
| **Máquina de estados** | Transiciones válidas del pedido (pago/global) y del seller_order (cumplimiento), con estados de compensación ([G2]) | `orders/state.ts` |
| **createOrder / confirm / cancel** | Reserva stock atómica, enforce `maxSellersPerOrder` **por config** (V1=1; subir el flag habilita multi-seller), rollback atómico, eventos por outbox | `orders/orders.ts` |

**56 tests** (54 verdes + 2 gated a Neon). Pendiente de F3: **Payments + ledger de doble
partida** (allocations, refund parcial) y **Payment Orchestrator**.

## Estructura

```
packages/
  contracts/   @commerce/contracts   tipos canónicos (sin lógica)
  platform/    @commerce/platform     multi-tenancy (RLS), config engine, rbac, money, outbox
apps/
  web/         (próximo) Next.js — PWA + API (BFF) sobre Vercel
docs/fase-0/   diseño y decisiones (revisión Fase 0)
```

## Desarrollo

```bash
npm install
npm run build       # tsc --build (project references)
npm run typecheck
npm test            # vitest — incluye la prueba de aislamiento RLS sobre Postgres (WASM)
```

**Tests de aislamiento contra Neon:** seteá `TEST_DATABASE_URL` y corre `npm test`; el
test `db/isolation.test.ts` valida el helper `withTenant` (postgres.js) en el entorno
real. Sin esa variable, igual corre `db/rls.pglite.test.ts`, que prueba la política RLS
sobre Postgres en WASM (sin servidor).

## Principio rector

Toda decisión comercial es **config**, nunca código. Prohibido `if tenant == "..."`.
Ver [`docs/fase-0/07-configuracion.md`](docs/fase-0/07-configuracion.md).
