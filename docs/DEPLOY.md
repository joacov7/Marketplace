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
2. **Root Directory**: `apps/web`.
   Vercel detecta el monorepo (npm workspaces) e instala desde la raíz solo. El
   `apps/web/vercel.json` ya define `framework: nextjs`, el **Build Command**
   (`npm --prefix ../.. run build && next build` → compila los paquetes del monorepo y
   luego la app) y los **crons**. No hace falta tocar Output Directory: al declarar el
   framework, Vercel usa `.next` (si ves el error *"No Output Directory named public"*,
   es porque no se detectó el framework — asegurate de que `vercel.json` tenga
   `"framework": "nextjs"` y no overridees el Build Command en el dashboard).
3. **Environment Variables** (Production + Preview):

   | Variable | Valor |
   |----------|-------|
   | `DATABASE_URL` | el connection string de Neon (con pooler) |
   | `ADMIN_API_TOKEN` | un secreto fuerte (para provisioning de tenants) |
   | `CRON_SECRET` | un secreto fuerte (Vercel lo manda como `Authorization: Bearer` a los crons) |

4. Deploy. Vercel corre `apps/web/vercel.json` → build de paquetes + `next build`, y
   registra los 2 crons (drain de outbox cada minuto, barrido de reservas cada 5 min).

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
