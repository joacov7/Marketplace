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
| **Aislamiento multi-tenant (RLS)** | Postgres niega filas de otros tenants aunque el código olvide el `WHERE`. `withTenant()` setea `app.tenant_id` por transacción. **Probado sobre Postgres real.** | `packages/platform/src/db/` |
| **Configuration Engine** | Resolución por herencia (platform→tenant→region→merchant→user), versionado, effective-dating, validación por JSON Schema | `packages/platform/src/config/` |
| **RBAC scopeado** | Permisos verbo:recurso con contención por scope; sin cruce entre tenants; flag de MFA | `packages/platform/src/rbac/` |
| **Money** | Aritmética en centavos (nunca float) + `allocate` que reparte sin perder centavos (PaymentAllocation) | `packages/platform/src/money/` |
| **Outbox transaccional** | Evento en la misma tx que el cambio de estado; drenado por Cron/QStash | `packages/platform/src/outbox/` |
| **Contracts** | Tipos canónicos sin lógica (Money, TenantContext, Config, RBAC, Event) | `packages/contracts/` |

Pendiente de F1: app Next.js (BFF + route handlers), Identity/auth, provisioning de tenant.

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
