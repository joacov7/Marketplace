# G — Contratos de API

Responde al punto 10 (contratos API). Nivel de diseño; los contratos completos se
materializan en `docs/API.md` (sección 16 del doc) al implementar.

## Principios de la API

- **API-first, REST/JSON** (o tRPC internamente entre BFF y módulos, dado que todo es
  TypeScript — evita duplicar tipos). REST hacia clientes externos/PWA.
- **Multi-tenancy en cada request**: el tenant se resuelve del **dominio/subdominio** o
  del JWT, nunca de un parámetro que el cliente pueda falsear. Setea el `TenantCtx` que
  alimenta RLS.
- **Versionado**: prefijo `/v1`. Cambios breaking → `/v2`. Contratos de evento
  versionados aparte.
- **Idempotencia**: `Idempotency-Key` header obligatorio en operaciones no-idempotentes
  que mueven dinero/estado (checkout, refund).
- **Errores tipados**: formato consistente `{ code, message, details }`; nunca filtrar
  info de otro tenant en mensajes de error.
- **Paginación** por cursor en listados.

## Superficie por rol (BFF)

| Rol | Ejemplos de endpoints |
|-----|-----------------------|
| Cliente | `GET /v1/catalog`, `GET /v1/products/:id`, `POST /v1/cart`, `POST /v1/checkout` (Idempotency-Key), `GET /v1/orders/:id`, `POST /v1/agent/query`, `POST /v1/orders/:id/repeat` |
| Comercio | `GET /v1/merchant/orders`, `POST /v1/merchant/orders/:id/transition`, `GET/PUT /v1/merchant/catalog`, `PUT /v1/merchant/inventory`, `GET /v1/merchant/simulator`, `GET /v1/merchant/settlements` |
| Cadete | `GET /v1/driver/deliveries`, `POST /v1/driver/deliveries/:id/pickup`, `POST /v1/driver/deliveries/:id/deliver` (evidencia) |
| Tenant Admin | `PUT /v1/admin/config/:key`, `POST /v1/admin/domains`, `POST /v1/admin/users`, `PUT /v1/admin/branding` |
| Super Admin | `POST /v1/platform/tenants`, `PUT /v1/platform/features`, `GET /v1/platform/observability` |

## Contratos clave (forma, no exhaustivo)

### Checkout (idempotente, dinero)

```http
POST /v1/checkout
Idempotency-Key: <uuid generado por el cliente>
{
  "cartId": "...",
  "addressId": "...",
  "deliveryWindow": "...",
  "paymentMethod": "mp_checkout_pro"
}
→ 201 { "orderId", "paymentHandle", "status": "pending_payment" }
```
Reintentar con la misma `Idempotency-Key` devuelve la **misma** orden, no crea otra
([D2$]).

### Webhook de pago (idempotente, verificado)

```http
POST /v1/webhooks/payments/:merchantId
X-Signature: <firma del PSP>
{ "type": "payment.approved", "id": "<provider_event_id>", ... }
→ 200 (siempre; procesamiento idempotente por provider_event_id)
```
Verificación de firma con el **secreto de ese merchant** ([S3]); dedupe por
`provider_event_id`.

### Transición de pedido (RBAC + máquina de estados)

```http
POST /v1/merchant/orders/:id/transition
{ "to": "preparing" }
→ 200 { "status": "preparing" }   // valida transición permitida + actor autorizado
```

### Config (auditada)

```http
PUT /v1/admin/config/commission.rate
{ "scopeType": "merchant", "scopeId": "...", "value": 0.06, "effectiveFrom": "...", "reason": "..." }
→ 200   // valida contra jsonSchema; registra actor + version
```

### Consulta al agente (propose-only)

```http
POST /v1/agent/query
{ "message": "comida para perro senior ~$X" }
→ 200 { "reply": "...", "proposedCart": { items: [...] } }   // NO ejecuta compra
```
El `proposedCart` requiere que el humano confirme vía `/v1/checkout` ([S2]).

## Contratos de evento (outbox)

Versionados, consumidos por Notifications/Analytics/Profitability/Agent Integration.
Ej.: `order.confirmed@v1`, `payment.captured@v1`, `delivery.completed@v1`,
`config.changed@v1`. Cambiar el transporte (tabla→broker) en V2 no cambia estos
contratos.
