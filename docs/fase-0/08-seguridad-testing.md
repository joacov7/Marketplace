# H — Seguridad y testing

Responde a los puntos 13 y 14 del brief. Prioridad máxima.

## Seguridad

### Aislamiento multi-tenant (el punto #1)

- **Enforcement por construcción, no por disciplina** ([S1]/D4): Postgres RLS +
  contexto de tenant obligatorio por transacción (`SET LOCAL app.tenant_id`). Aunque el
  código olvide `WHERE tenant_id`, la base niega las filas ajenas.
- **Falla cerrado**: sin `TenantCtx` no se ejecuta (mismo principio que agent-core).
- **Test como ciudadano de primera clase**: por cada entidad, un test que prueba que el
  tenant B **no puede** leer/escribir datos del A (abajo).

### Agent permissions

- Los agentes solo usan tools autorizadas; toda tool de escritura pasa por el
  enforcement de agent-core (ver [06-agentes-ia.md](06-agentes-ia.md)).
- Customer Agent **sin tools de dinero** (propose-only).

### Payments

- No duplicar cobros: idempotencia en checkout **y** en webhooks ([D2$]).
- No almacenar tarjetas (tokenización del PSP; reduce alcance PCI).
- Ledger de doble partida + conciliación con alertas.
- Secretos de PSP **por-merchant**, cifrados (envelope/KMS) — nunca en config plana ([S3]).

### Admin

- RBAC scopeado (tenant/region/merchant) + **MFA obligatorio** para roles admin/dinero.
- Permisos verbo+recurso; `payout:approve`, `config:write`, etc. como permisos finos.

### Audit

- Log de acciones sensibles: cambios de config de dinero (comisión/precio, con
  `actor`+`reason`+`effective_from`), transiciones de pedido, refunds, payouts, acciones
  de agentes (`ResultadoAccion`).

### Secrets

- Nunca en código. Secrets manager / variables de entorno / columnas cifradas. Rotación
  soportada. (agent-core ya no guarda secretos de dominio.)

### PII

- Datos de mascota/salud, direcciones, hábitos = PII ([S4]). Minimización, marcado,
  borrado/export por cliente, no loguear PII, no cruzar tenants.

### Otras

- Rate limiting por tenant/usuario en el gateway.
- Validación de input en el borde (schemas).
- HTTPS/headers de seguridad, CORS por dominio de tenant.

## Estrategia de testing (punto 14 del brief)

Tests que **demuestran los límites críticos** — no cobertura por cobertura. La pirámide:

| Nivel | Qué cubre | Ejemplos críticos |
|-------|-----------|-------------------|
| **Unit** | Lógica pura (cálculos, reglas, máquina de estados) | Fórmula de contribución (ambas vistas), resolución de config por precedencia, transiciones válidas del pedido |
| **Integration** | Módulo + DB (con RLS activo) | Reserva de stock sin oversell, escritura de config validada por schema |
| **E2E** | Flujo completo | Comprar → pagar → preparar → entregar; repetir compra |
| **Seguridad / aislamiento** | Invariantes de tenancy | **Tenant B no accede a datos de A** (por cada entidad); agente sin tool de dinero no puede pagar |
| **Pagos / dinero** | Invariantes de plata | **Webhook repetido no duplica** pago/pedido; **refund parcial preserva las demás partidas**; idempotency-key de checkout; conciliación detecta discrepancia |
| **Delivery** | Costeo y estados | Tarifa por zona/distancia; entrega fallida → compensación |
| **Agent tools / permisos** | Enforcement | Agente fuera de scope es bloqueado; presupuesto IET excedido falla cerrado |

### Tests que mapean 1:1 a los criterios de aceptación (sección 17)

Cada criterio de aceptación del documento se convierte en un test bloqueante de CI:

- [ ] Crear un segundo tenant sin tocar código → test de provisioning por config.
- [ ] Cambiar branding y dominio por config → test de resolución de config.
- [ ] Activar/desactivar módulos con feature flags → test de flags.
- [ ] Pedido V1 aislado a 1 comercio y 1 entrega → test del invariante `maxSellersPerOrder=1`.
- [ ] Datos/métricas aislados por tenant → **test de aislamiento RLS por entidad**.
- [ ] Cliente compra, repite y usa agente → E2E.
- [ ] Simulador calcula escenarios modificables → test de cálculo + persistencia.
- [ ] **Webhook repetido no duplica** → test de idempotencia de webhook.
- [ ] **Refund parcial conserva integridad de otras partidas** → test de ledger.
- [ ] Agente no ejecuta fuera de scopes → test de enforcement.
- [ ] Multi-seller se agrega sin rehacer Order → test que sube `maxSellersPerOrder` y
      crea 2 SellerOrders sin migración de esquema.

### CI gate

Lint + typecheck + toda la suite (incluidos aislamiento y pagos) como condición de
merge (GitHub Actions, igual que agent-core). Un PR que rompe un invariante de tenancy o
de dinero **no mergea**.

## Observabilidad (sección 15, ampliada)

- Health checks, métricas (OpenTelemetry), logs estructurados, tracing, alertas.
- **Métricas por tenant** (para billing/análisis y para detectar anomalías por tenant).
- **Tablero de conciliación de dinero** (ledger vs settlement del PSP).
- Backups + **restore probado** (no basta con hacer backups; hay que probar restaurar).
