# Deploy en Vercel + Neon

Guía para levantar el Commerce OS. La app vive en `apps/web` (Next.js). La base es
Postgres en **Neon**. Tiempo estimado: ~15 min.

> Para la operación del día a día (panel, backups, rotar llaves, "cuando algo se rompe")
> ver [`MANUAL-OPERACION.md`](MANUAL-OPERACION.md).

## 1. Base de datos (Neon)

1. Creá un proyecto en [neon.tech](https://neon.tech) (región cercana, ej. `aws-sa-east-1`).
2. Copiá el **connection string** con **pooler** (termina en `-pooler...`) y `sslmode=require`.
   El pooler en modo transacción es lo que necesita el `SET LOCAL` de RLS.
3. Guardalo como `DATABASE_URL` (la app también acepta `POSTGRES_URL`, el nombre que setea la
   integración Neon de Vercel).

> El rol de Neon es el *owner* no-superusuario de las tablas; `FORCE ROW LEVEL SECURITY`
> lo constriñe, así que el aislamiento por tenant aplica sin configuración extra.

## 2. Deploy en Vercel

1. Importá el repo en [vercel.com/new](https://vercel.com/new).
2. **Root Directory** (CRÍTICO): `apps/web`.
   Settings → General → **Root Directory** = `apps/web`. Vercel lee `vercel.json` **solo**
   desde el Root Directory; si queda en la raíz del repo, `apps/web/vercel.json` se ignora,
   Next NO se detecta y verás *"No Output Directory named public"*.
3. **Framework Preset**: Settings → Build & Development → **Next.js** (no "Other"). El
   dashboard puede pisar el `framework` de `vercel.json`, así que confirmá que diga
   Next.js. Dejá el **Build Command** sin override (usa el de `vercel.json`: `npm run build`).

> Si el error *"No Output Directory named public"* persiste: es SIEMPRE detección de
> framework. Revisá (a) Root Directory = `apps/web`, (b) Framework Preset = Next.js. No es
> un problema del código.

4. **Environment Variables** (Production + Preview):

   | Variable | Valor |
   |----------|-------|
   | `DATABASE_URL` | el connection string de Neon (con pooler) |
   | `ADMIN_API_TOKEN` | un secreto fuerte: código maestro del panel y de las rutas de plataforma |
   | `SESSION_SECRET` | un secreto fuerte **distinto** (firma las sesiones; si falta, usa `ADMIN_API_TOKEN`) |
   | `CRON_SECRET` | un secreto fuerte (Vercel lo manda como `Authorization: Bearer` al cron) |
   | `ANTHROPIC_API_KEY` | *(opcional)* activa el Vendedor IA con Claude; sin ella el chat usa un responder básico |
   | `VENDOR_MODEL` | *(opcional)* modelo del Vendedor IA (default `claude-haiku-4-5`) |
   | `PAYMENTS_ENCRYPTION_KEY` | frase larga (32+ caracteres): cifra el Access Token de Mercado Pago en la base. Necesaria para "Pagar ahora". **No cambiarla** después de conectar MP |
   | `PUBLIC_BASE_URL` | *(opcional)* URL pública (`https://tudominio.com`) para los links de vuelta y avisos de MP; si falta, se toma del request |

5. Deploy. En cada deploy Vercel corre, en orden:
   - `prebuild`: compila los paquetes del monorepo (`tsc --build`);
   - `next build`;
   - `postbuild`: **aplica las migraciones pendientes** (ver abajo).

   Y registra el cron diario de `vercel.json`.

### Migraciones (automáticas)

No hay que correr nada a mano: `scripts/migrate-prod.mjs` corre en el `postbuild` de cada
deploy y:

- **Trackea** lo aplicado en la tabla `schema_migrations` → solo corre las migraciones nuevas.
  El primer deploy aplica todas (0000–0019, idempotentes) y pobla el tracking.
- Toma un **lock de Postgres** → dos deploys simultáneos no se pisan.
- **Sin `DATABASE_URL`** (p. ej. un preview sin base) no hace nada y el build sigue OK.
- **Si una migración falla**, el build falla y el deploy **no se promociona** (el sitio sigue
  en la versión anterior).

En los logs del build buscá las líneas `[migrate]`. El orden de las migraciones vive en
`scripts/migrations-list.mjs` (al agregar una nueva, se suma ahí).

**Alternativas manuales** (no deberían hacer falta):

```bash
# desde tu máquina
npm install && npm run build
DATABASE_URL="postgres://...-pooler.../db?sslmode=require" npm run migrate

# o contra el deploy (mismo tracking que el automático)
curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" https://<deploy>/api/admin/migrate
```

## 3. Datos de demo (opcional)

Para ver la tienda con productos sin cargarlos a mano:

```bash
# contra el deploy: migra (si falta algo) y siembra el tenant "gualeguay"
curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" \
  "https://<deploy>/api/admin/migrate?seed=gualeguay"

# o desde tu máquina (requiere npm run build)
DATABASE_URL="..." SEED_TENANT_SLUG="gualeguay" npm run seed
```

Crea el tenant (plantilla Pet Shop), un comercio y productos de ejemplo con stock.
Es idempotente: no duplica si ya existe. **No lo corras en la base de un comercio real.**

## 4. Primer usuario del panel

El panel (`/merchant`) se abre con usuario y contraseña. El primer admin se crea con el
código maestro (`ADMIN_API_TOKEN`); después, ese admin puede sumar usuarios desde el panel.

```bash
curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
  -d '{"email":"duenio@ejemplo.com","password":"una-contraseña-larga"}' \
  "https://<deploy>/api/merchant/auth/bootstrap?tenant=gualeguay"
```

La contraseña tiene que tener al menos 8 caracteres. El código maestro sigue funcionando
como respaldo para entrar al panel, así que no hay forma de quedar afuera.

## 5. Cron diario

`apps/web/vercel.json` define **un solo cron**: `/api/cron/daily` a las `0 6 * * *` (UTC).
El plan **Hobby** de Vercel limita la cantidad de crons y solo permite cadencia diaria, por
eso las tres tareas de mantenimiento corren juntas desde ahí (si una falla, las otras corren
igual):

1. drena el **outbox** (eventos pendientes);
2. libera **reservas de stock vencidas** y repone inventario;
3. genera los pedidos de las **suscripciones** vencidas (auto-envío);
4. cancela los pedidos **"Pagar ahora" abandonados** (más de 3 días sin pagarse en Mercado Pago).

Cada tarea también tiene su ruta para dispararla a mano:

```bash
curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/outbox
curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/reservations
curl -H "authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/subscriptions
```

Para más frecuencia (p. ej. barrer reservas cada pocos minutos):

- **Vercel Pro**: agregás entradas con `schedule` más frecuente en `vercel.json`.
- **Scheduler externo (gratis)**: [cron-job.org](https://cron-job.org), **Upstash QStash** o
  una GitHub Action que le pegue a esas rutas con `Authorization: Bearer $CRON_SECRET`.

> En V1 el outbox solo loguea eventos y las reservas tienen TTL de 15 min, así que el
> barrido diario alcanza para operar un comercio chico.

## 6. Resolución de tenant por dominio

El tenant se resuelve por **subdominio**: `gualeguay.tudominio.com` → tenant `gualeguay`.

- En Vercel, agregá el dominio y un **wildcard** `*.tudominio.com` para que cada tenant
  tenga su subdominio.
- Sin DNS, las pantallas aceptan `?tenant=<slug>` (p. ej. `/reparto?tenant=gualeguay`) y la
  API el header `x-tenant` (solo dev/pruebas):

```bash
curl -H "x-tenant: gualeguay" https://<tu-deploy>.vercel.app/api/catalog
```

## 7. Probar

```bash
# health (incluye ping a la DB)
curl https://<deploy>/api/health

# catálogo del tenant
curl -H "x-tenant: gualeguay" https://<deploy>/api/catalog

# Vendedor IA (propose-only): responde y, si hay intención de compra, propone un carrito. NO compra
curl -X POST -H "x-tenant: gualeguay" -H "content-type: application/json" \
  -d '{"message":"comida para mi perro"}' https://<deploy>/api/agent/query

# provisioning de un segundo tenant (sin tocar código)
curl -X POST -H "authorization: Bearer $ADMIN_API_TOKEN" -H "content-type: application/json" \
  -d '{"slug":"parana","name":"Pet Shop Paraná","region":{"slug":"parana","name":"Paraná"}}' \
  https://<deploy>/api/admin/tenants
```

Pantallas:

| URL | Qué es |
|-----|--------|
| `https://gualeguay.tudominio.com/` | Tienda |
| `/merchant` | Panel del comercio (login) |
| `/reparto?tenant=gualeguay` | Pantalla del repartidor (instalable en el celular) |
| `/seguimiento/<orderId>?tenant=gualeguay` | Seguimiento público de un pedido |

## 8. Mercado Pago ("Pagar ahora")

Con `PAYMENTS_ENCRYPTION_KEY` cargada, el comercio conecta su cuenta desde el panel
(Configuración → Cobros online): pega su Access Token, la app lo valida contra MP y lo guarda
cifrado. Paso a paso para el comercio en [`MANUAL-OPERACION.md`](MANUAL-OPERACION.md#cobrar-online-con-mercado-pago-pagar-ahora).

Cómo funciona (Checkout Pro):

1. Checkout con `payment: "mercadopago"` → reserva stock por 30 min, crea la preferencia en MP
   (`external_reference` = id del pedido, vence a los 30 min, sin efectivo/cajero) y devuelve
   `redirectUrl`.
2. El cliente paga en MP y vuelve a `/seguimiento/<id>?pago=aprobado|pendiente|error`.
3. MP avisa a `/api/webhooks/payments/<merchantId>?tenant=<slug>`. La app **consulta el pago a
   la API de MP** con el token del comercio (nunca confía en el body del aviso), controla el
   monto y captura: ledger + pedido confirmado. Si el comercio cargó la clave secreta de
   webhooks, también valida la firma `x-signature`.
4. Al volver, el seguimiento llama a `/api/payments/mercadopago/sync` (misma verificación):
   no depende solo del webhook. Ambos caminos son idempotentes.

Probar el circuito sin plata real: Access Token de prueba (`TEST-…`) y las tarjetas de prueba
de MP. Para desarrollo local sin MP, `MERCADOPAGO_API_BASE` apunta a un simulador (se ignora
en producción).

## Pendiente antes de escalar

- **MFA** para el panel y **login por repartidor** (hoy entra con un código compartido).
- **Validación fiscal** (contador/abogado AR) antes de facturar.
- **Tests de aislamiento contra Neon en CI**: setear el secret `TEST_DATABASE_URL`
  (una base de test, no la de prod) para que corran los 2 tests gated.
