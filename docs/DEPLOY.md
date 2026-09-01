# Deploy en Vercel + Neon

Guía para levantar el Commerce OS. La app vive en `apps/web` (Next.js). La base es
Postgres en **Neon**. Tiempo estimado: ~15 min.

## 1. Base de datos (Neon)

1. Creá un proyecto en [neon.tech](https://neon.tech) (región cercana, ej. `aws-sa-east-1`).
2. Copiá el **connection string** con **pooler** (termina en `-pooler...`) y `sslmode=require`.
   El pooler en modo transacción es lo que necesita el `SET LOCAL` de RLS.
3. Guardalo como `DATABASE_URL`.

> El rol de Neon es el *owner* no-superusuario de las tablas; `FORCE ROW LEVEL SECURITY`
> lo constriñe, así que el aislamiento por tenant aplica sin configuración extra.

## 2. Migraciones

Desde tu máquina, con el repo clonado:

```bash
npm install
npm run build                 # compila los paquetes (dist) que usa la app
DATABASE_URL="postgres://...-pooler.../db?sslmode=require" npm run migrate
```

Aplica las 5 migraciones (idempotentes: se pueden re-correr). Deja el esquema completo:
tenancy + config + outbox + catálogo + inventario + órdenes + pagos/ledger + delivery,
todo bajo RLS.

## 3. Datos de demo (opcional, para ver la home con productos)

```bash
DATABASE_URL="..." SEED_TENANT_SLUG="gualeguay" npm run seed
```

Crea un tenant `gualeguay` (plantilla Pet Shop), un comercio y 3 productos con stock.

## 4. Deploy en Vercel

1. Importá el repo en [vercel.com/new](https://vercel.com/new).
2. **Root Directory** (CRÍTICO): `apps/web`.
   Settings → General → **Root Directory** = `apps/web`. Vercel lee `vercel.json` **solo**
   desde el Root Directory; si queda en la raíz del repo, `apps/web/vercel.json` se ignora,
   Next NO se detecta y verás *"No Output Directory named public"*. El `prebuild` de
   `apps/web` compila los paquetes del monorepo antes de `next build`.
3. **Framework Preset**: Settings → Build & Development → **Next.js** (no "Other"). El
   dashboard puede pisar el `framework` de `vercel.json`, así que confirmá que diga
   Next.js. Dejá el **Build Command** sin override (usa el de `vercel.json`: `npm run
   build`).

> Si el error *"No Output Directory named public"* persiste: es SIEMPRE detección de
> framework. Revisá (a) Root Directory = `apps/web`, (b) Framework Preset = Next.js. No es
> un problema del código.
4. **Environment Variables** (Production + Preview):

   | Variable | Valor |
   |----------|-------|
   | `DATABASE_URL` | el connection string de Neon (con pooler) |
   | `ADMIN_API_TOKEN` | un secreto fuerte (para provisioning de tenants) |
   | `CRON_SECRET` | un secreto fuerte (Vercel lo manda como `Authorization: Bearer` a los crons) |

5. Deploy. Vercel corre el `prebuild` (compila los paquetes) + `next build`, y registra
   los 2 crons.

### Crons y el plan de Vercel

El plan **Hobby (gratis) solo permite crons diarios**. Por eso `vercel.json` los deja en
una vez por día (`0 6 * * *` y `30 6 * * *`) — suficiente para arrancar. Para cadencia
real (el outbox conviene drenarlo seguido) tenés dos caminos:

- **Vercel Pro**: cambiás el `schedule` a `* * * * *` (outbox) y `*/5 * * * *` (reservas).
- **Scheduler externo (gratis)**: dejás los crons diarios (o los sacás) y programás un
  servicio externo — [cron-job.org](https://cron-job.org), **Upstash QStash** o una
  GitHub Action — que le pegue cada minuto a los endpoints con el header
  `Authorization: Bearer $CRON_SECRET`:

  ```bash
  curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/outbox
  curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/reservations
  ```

> En V1 el outbox solo loguea eventos (las notificaciones se cablean después) y las
> reservas tienen TTL de 15 min, así que un barrido diario no rompe nada para una demo;
> para operar en serio, usá cadencia frecuente por una de las dos vías de arriba.

## 5. Resolución de tenant por dominio

El tenant se resuelve por **subdominio**: `gualeguay.tudominio.com` → tenant `gualeguay`.

- En Vercel, agregá el dominio y un **wildcard** `*.tudominio.com` para que cada tenant
  tenga su subdominio.
- Para probar sin DNS, pasá el header `x-tenant` (solo dev/pruebas):

```bash
curl -H "x-tenant: gualeguay" https://<tu-deploy>.vercel.app/api/catalog
```

## 6. Probar

```bash
# health (incluye ping a la DB)
curl https://<deploy>/api/health

# catálogo del tenant
curl -H "x-tenant: gualeguay" https://<deploy>/api/catalog

# agente (propose-only): devuelve un carrito propuesto, NO compra
curl -X POST -H "x-tenant: gualeguay" -H "content-type: application/json" \
  -d '{"message":"comida para mi perro"}' https://<deploy>/api/agent/query

# provisioning de un segundo tenant (sin tocar código)
curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"parana","name":"Pet Shop Paraná","region":{"slug":"parana","name":"Paraná"}}' \
  https://<deploy>/api/admin/tenants
```

Abrí `https://gualeguay.tudominio.com` (o el deploy con el subdominio) para ver la home
con branding y catálogo.

## Pendiente antes de operar con plata real

- **Auth de usuario + MFA** (Clerk/Auth0/NextAuth): hoy está el gate de servicio para
  provisioning/crons; el `x-customer-id` del agente es placeholder de sesión.
- **Mercado Pago**: implementar `PaymentProvider` real (hoy `FakePaymentProvider`) con
  verificación de firma por-merchant. Ver `docs/fase-0/05-pagos-y-economia.md`.
- **Validación fiscal** (contador/abogado AR) antes de facturar.
- **Tests de aislamiento contra Neon en CI**: setear el secret `TEST_DATABASE_URL`
  (una base de test, no la de prod) para que corran los 2 tests gated.
