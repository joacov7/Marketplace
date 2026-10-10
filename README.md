# Commerce OS

White Label **Multi-Tenant Commerce OS**. Core agnóstico de vertical,
*configuration-first*, multi-tenant con **aislamiento por RLS**. Arranca como Pet Shop
propio (Pet Shop Gualeguay) y evoluciona a marketplace / White Label / multi-vertical
**sin rehacer el core**.

- **Diseño (Fase 0):** [`docs/fase-0/`](docs/fase-0/) — auditoría, decisiones, arquitectura,
  ERD, flujos, modelo económico. Empezá por [`docs/fase-0/11-cierre.md`](docs/fase-0/11-cierre.md).
- **Operatoria y roadmap de producto:** [`docs/operatoria-roadmap.md`](docs/operatoria-roadmap.md)
  — compra → entrega, flywheel de recompra, detalle de cada eslabón implementado.
- **Deploy:** [`docs/DEPLOY.md`](docs/DEPLOY.md) — full-stack **Next.js en Vercel** + **Neon**
  (Postgres) + **Upstash** (Redis/cola).
- **Manual de operación (no técnico):** [`docs/MANUAL-OPERACION.md`](docs/MANUAL-OPERACION.md)
  — panel, usuarios, backups, rotar llaves, "cuando algo se rompe".
- **Agent Core:** repo separado, integrado in-process como SDK (no se toca desde acá).

## Estado

Fases F1–F5 completas y la app operando el ciclo completo de un pet shop: tienda PWA,
checkout, panel del comercio, reparto, seguimiento, suscripciones y Vendedor IA.

**190 tests en verde** (+2 gated a Neon) · lint con límites de módulos · typecheck · `next build`
— todo corre en CI (`.github/workflows/ci.yml`).

### Core de plataforma (`@commerce/platform`)

| Pieza | Qué hace |
|-------|----------|
| **Port de DB** | Los módulos dependen de `Db`/`TenantAwareDb`, no del driver. Adaptador postgres.js (Neon, prod) y PGlite (tests). |
| **Aislamiento multi-tenant (RLS)** | Postgres niega filas de otros tenants aunque el código olvide el `WHERE`. `withTenant()` setea `app.tenant_id` por transacción. Probado sobre Postgres real. |
| **Configuration Engine** | Herencia platform→tenant→region→merchant→user, versionado, effective-dating, validación por JSON Schema, registro tipado de claves. |
| **Provisioning de tenant** | `createTenant()` crea tenant + región y aplica una **plantilla de vertical** (Pet Shop) — todo por datos. |
| **Auth + RBAC** | Usuarios, hash de contraseña, sesiones firmadas en cookie httpOnly, permisos verbo:recurso con contención por scope. |
| **Money** | Aritmética en centavos (nunca float) + `allocate` que reparte sin perder centavos. |
| **Outbox transaccional** | Evento en la misma tx que el cambio de estado; drenado por cron. |

### Módulos de dominio (`@commerce/modules`)

| Módulo | Qué hace |
|--------|----------|
| **catalog** | Productos, variantes, precios versionados (con precio de lista), categorías ordenables/ocultables, fotos subidas como archivo (guardadas en la base), info nutricional, **combos/cajas**. |
| **inventory** | Reserva atómica anti-oversell (`available >= qty`), ciclo reserve(TTL)→confirm/release, barrido de vencidas. |
| **orders** | Order → SellerOrder → OrderItem (multi-seller sin rehacer el modelo), máquina de estados, canales (web / manual / suscripción), pago al recibir, **aceptar/rechazar**, pedido manual/mostrador, seguimiento del cliente. |
| **payments** | `PaymentProvider` abstracto con **Mercado Pago (Checkout Pro)** real: credenciales por comercio cifradas, webhook verificado contra la API de MP, control de monto. Allocations exactas, **ledger de doble partida**, captura idempotente, refund parcial, **cobro al entregar** (`settleCashOnDelivery`). |
| **delivery** | Costeo por zona (costo + ETA por barrio) o plano por config, gratis sobre umbral, mínimo de envío por segmento, agenda de entrega (turnos, días, corte, franjas), radio y pin del local. |
| **customer** / **pets** | Ficha de cliente **por teléfono** (sin obligar registro) y perfil de mascota — la mascota es protagonista del pedido ("Pedido de Bruno"). |
| **subscriptions** | Auto-envío cada X días: genera el pedido solo, cobro al recibir, descuento opcional por config. |
| **agent** | Customer Shopping Agent **propose-only** (garantía estructural: no puede cobrar ni crear pedidos), presupuesto de IA por tenant. |
| **content** | Estudio de Contenido: post del día (texto + placa) para redes. |
| **reports** | Ventas, ventas por día de la semana y por turno, métrica de suscripción (% que confirma). |
| **profitability** | Motor de rentabilidad (fórmula corregida de Fase 0) + simulador de escenarios y break-even. |
| **adoptions** | Mascotas en adopción de protectoras asociadas. |

### App (`apps/web`, Next.js App Router sobre Vercel)

| Pantalla | Qué es |
|----------|--------|
| `/` | Tienda PWA: tenant por subdominio, branding por config, catálogo, checkout (dirección + referencias + GPS opcional, zona, horario sugerido, pago al recibir o **Mercado Pago**), cuenta del cliente (mascotas, pedidos, "repetir última compra", reposición, suscripciones), **Vendedor IA** flotante. |
| `/merchant` | Panel del comercio (login por usuario + rol admin): pedidos (aceptar/rechazar, preparar, pedido manual), catálogo, categorías, combos, zonas y agenda de reparto, suscripciones, adopciones, diseño, contenido, reportes y **Configuración** (cobros online con Mercado Pago, parámetros y funciones activables). |
| `/reparto` | Pantalla del repartidor (PWA instalable): entregas del día, "Cómo llegar" (al pin exacto si hay), WhatsApp, En camino → Entregado + registro del cobro. |
| `/seguimiento/[id]` | Seguimiento público del pedido (sin login): Recibido → En preparación → En camino → Entregado. |

API principal (route handlers en `apps/web/app/api/`):

| Grupo | Rutas |
|-------|-------|
| Tienda | `catalog`, `checkout`, `checkout/quote`, `zones`, `customer/lookup`, `track/[id]`, `adoptions`, `images/[id]`, `agent/query`, `payments/mercadopago/sync` |
| Cuenta del cliente | `auth/*`, `account/{orders,pets,reorder,replenishment}`, `subscriptions` |
| Panel | `merchant/*` (auth, catalog, categories, combos, orders, zones, delivery-*, subscriptions, adoptions, branding, images, content, reports, settings, payments/mercadopago) |
| Reparto | `delivery/orders`, `delivery/orders/[id]/{status,deliver}` |
| Plataforma | `admin/{tenants,merchants,migrate}` (gated por `ADMIN_API_TOKEN` o sesión admin), `webhooks/payments/[merchantId]`, `health` |
| Cron | `cron/daily` (outbox + reservas vencidas + suscripciones + pedidos online abandonados; único cron en `apps/web/vercel.json`), y `cron/{outbox,reservations,subscriptions}` para dispararlos a mano |

- **Resolución de tenant en el borde**: subdominio del Host (o `x-tenant` en dev) → id →
  `withTenant`/RLS. Nunca de un parámetro del body.
- **Migraciones automáticas**: corren en el `postbuild` del deploy (`scripts/migrate-prod.mjs`)
  con tracking (`schema_migrations`) y lock de Postgres. El orden vive en
  `scripts/migrations-list.mjs` (0000–0022).

## Estructura

```
packages/
  contracts/   @commerce/contracts   tipos canónicos (sin lógica)
  platform/    @commerce/platform    multi-tenancy (RLS), config, auth/rbac, money, outbox
  modules/     @commerce/modules     dominio: catalog, inventory, orders, payments, delivery, …
apps/
  web/         Next.js — tienda PWA, panel, reparto y API (BFF) sobre Vercel
scripts/       migraciones (prod + generación para el panel) y seed de demo
docs/          Fase 0, operatoria/roadmap, deploy, manual de operación
```

Límites de módulos (enforced por ESLint): `contracts` → nada, `platform` → contracts,
`modules` → contracts + platform, `apps/web` → todo. Un import "hacia arriba" rompe el CI.

## Desarrollo

```bash
npm install
npm run build       # tsc --build — compila los paquetes (dist). Hacelo ANTES de los tests:
                    # los tests de módulos importan los paquetes compilados.
npm run typecheck
npm run lint
npm test            # vitest — incluye RLS sobre Postgres en WASM (PGlite), sin servidor

# app en dev (necesita DATABASE_URL apuntando a un Postgres con las migraciones)
npm run migrate                 # aplica migraciones pendientes
npm run seed                    # datos de demo (opcional)
npm run dev -w @commerce/web
# probar con un tenant: curl -H "x-tenant: gualeguay" localhost:3000/api/catalog
```

**Tests contra Postgres real:** seteá `TEST_DATABASE_URL` (una base de PRUEBA) y corré `npm test`.
Corren con postgres.js, el driver de producción: `db/isolation.test.ts` (aislamiento por RLS) y
`orders/jsonb.pg.test.ts` (que las columnas jsonb se guarden como objeto/valor y no como string
JSON — un bug que PGlite no reproduce). Sin esa variable se saltan.

### Variables de entorno

| Variable | Para qué |
|----------|----------|
| `DATABASE_URL` | Postgres (Neon, con pooler y rol no-superusuario). |
| `ADMIN_API_TOKEN` | Código maestro del panel / rutas de plataforma (respaldo del login por usuario). |
| `SESSION_SECRET` | Firma de sesiones (si falta, cae a `ADMIN_API_TOKEN`). |
| `CRON_SECRET` | Autoriza los Vercel Cron (`/api/cron/*`). |
| `ANTHROPIC_API_KEY` | Vendedor IA. Sin ella, el agente degrada a un responder determinista. |
| `VENDOR_MODEL` | Modelo del Vendedor IA (default `claude-haiku-4-5`). |
| `PAYMENTS_ENCRYPTION_KEY` | Cifra los Access Tokens de Mercado Pago en la base (32+ caracteres). Sin ella no se ofrece "Pagar ahora". |
| `PUBLIC_BASE_URL` | Opcional: URL pública para los links de vuelta y avisos de MP. |
| `TEST_DATABASE_URL` | Opcional: tests de integración contra Neon. |

Ver [`.env.example`](.env.example). Las credenciales de Mercado Pago de cada comercio se cargan
desde el panel y se guardan cifradas en la base, nunca en el `.env`.

## Pendiente

- **Mercado Pago — siguientes pasos**: reembolsos desde el panel (hoy desde la cuenta de MP),
  cobro recurrente de suscripciones (preapproval) y conexión por OAuth (hoy se pega el token).
- **Auth**: login por repartidor (hoy código compartido) y MFA.
- **Flywheel**: recordatorio proactivo de reposición (WhatsApp/push), referidos, "alimento
  habitual" + recomendaciones en compra rápida.
- **Menores**: ordenar la cola de reparto por zona, que el cliente edite cadencia/cantidad de
  su suscripción, búsqueda semántica con `pgvector`, imputar descuento por transferencia al
  ledger.

Detalle y contexto en [`docs/operatoria-roadmap.md`](docs/operatoria-roadmap.md).

## Principio rector

Toda decisión comercial es **config**, nunca código. Prohibido `if tenant == "..."`.
Ver [`docs/fase-0/07-configuracion.md`](docs/fase-0/07-configuracion.md).
