# Pagos y modelo económico

Responde a los puntos 6 y 7 del brief. Prioridad máxima después de seguridad: es dinero.

## Payment Orchestrator (punto 7 del brief)

**Abstracción `PaymentProvider`** — el sistema no habla directo con Mercado Pago; habla
con una interfaz. MP es la primera implementación; mañana puede haber otra sin tocar el
dominio.

```typescript
interface PaymentProvider {
  createPayment(ctx: TenantCtx, intent: PaymentIntent): Promise<PaymentHandle>;
  capture(ctx, handle): Promise<PaymentResult>;
  refund(ctx, handle, amount: Money, reason): Promise<RefundResult>;   // parcial soportado
  verifyWebhook(rawBody, signature, secret): WebhookEvent | null;      // por-merchant
  getSettlement(ctx, period): Promise<SettlementReport>;               // conciliación
}
```

### Puntos que el brief pide analizar

- **Mercado Pago.** Primera impl. En **V1 (pet shop propio)** la plata va a la cuenta
  propia de la operación: caso simple. El diseño **no asume** que esto se mantiene.
- **Split payments.** El brief acierta al advertir: *"no asumas que multi-seller se
  resuelve con un único split"*. Correcto. Un pedido multi-comercio (V4) puede necesitar:
  varios sellers, subsidio de delivery de distinta fuente, promos financiadas por
  distintos actores, y comisiones distintas por comercio. Eso **no** es un `application_fee`
  plano. Por eso el reparto vive en **`PaymentAllocation` + ledger**, no en un parámetro
  de split del PSP. El split del PSP (cuando exista, D5) es *un mecanismo de ejecución*
  del reparto que ya calculó el ledger, no la fuente de verdad.
- **Refunds (incl. parciales).** Un refund parcial afecta **una** `PaymentAllocation`
  (ej. devolver el ítem de un comercio) sin tocar las demás. El ledger de doble partida
  garantiza que las otras partidas queden intactas (**criterio de aceptación #9**). Se
  testea explícitamente (ver [08](08-seguridad-testing.md)).
- **Pagos parciales.** Modelados como múltiples `Payment`/allocations contra un `Order`
  (ej. seña + saldo, o parte con loyalty). El ledger cierra.
- **Webhooks.** Verificación de firma **por-merchant** (cada uno con su secreto — [S3]),
  dedupe por `provider_event_id` (idempotencia [D2$]), procesamiento idempotente.
- **Idempotencia.** Dos niveles separados ([D2$]): `Idempotency-Key` en checkout +
  unique constraint en eventos de webhook.
- **Conciliación.** Job periódico que compara el `SettlementReport` del PSP contra el
  ledger y **alerta discrepancias** (tablero de conciliación en observabilidad). Sin
  esto, la plata "se pierde" silenciosamente.
- **Ledger.** Doble partida, fuente de verdad. `Payment`/`Refund`/`Payout` son
  proyecciones de asientos.
- **Payouts.** Liquidación a comercios (V2 marketplace). En V1 con comercio propio, el
  payout es interno/trivial; el modelo (`Payout` por `SellerOrder`) ya existe.

## Flujo de pago

```mermaid
sequenceDiagram
    participant Cli as Cliente
    participant OS as Commerce OS
    participant PSP as PaymentProvider (MP)
    participant LG as Ledger

    Cli->>OS: checkout (Idempotency-Key)
    OS->>OS: reserva stock (TTL) + crea Order/SellerOrder (pending_payment)
    OS->>PSP: createPayment(intent)
    PSP-->>Cli: brick/redirect de pago
    Cli->>PSP: paga
    PSP-->>OS: webhook (payment.approved) [firma + event_id]
    OS->>OS: verifica firma (secreto del merchant) + dedupe event_id
    OS->>LG: asienta (cliente→plataforma; allocations: merchant, comisión, delivery, psp_fee)
    OS->>OS: Order → confirmed, consume reserva, emite order.confirmed (outbox)
    OS-->>Cli: confirmación
    Note over OS,PSP: refund parcial luego: refund(handle, amount) afecta 1 allocation; ledger preserva el resto
```

---

## Profitability Engine (punto 6 del brief) — con la fórmula corregida

> **La fórmula del documento v3 (sección 8) está mal** ([D-ERR]): suma el GMV como
> ingreso y mezcla el P&L de la plataforma con el del comercio. Corrección:

### Vista Plataforma — contribución por pedido

```
contribución_plataforma =
    comisión_sobre_GMV
  + margen_logístico            (delivery cobrado − costo real del cadete)
  + ingresos_ads
  + ingresos_saas_prorrateado
  − fees_PSP
  − subsidio_delivery_financiado_por_plataforma
  − promociones_financiadas_por_plataforma
  − costo_IA                    (de agent-core: gasto por tenant/agente, ya atribuido)
  − otros_costos_plataforma
```
**El GMV es la base de la comisión y una métrica de reporte — nunca un sumando.**

### Vista Comercio — la que muestra el Simulador

```
contribución_comercio =
    ventas_incrementales (GMV del comercio vía plataforma)
  − comisión
  − CMV (costo de la mercadería vendida)
  − delivery_a_cargo_del_comercio
  − promociones_financiadas_por_comercio
```

### Arquitectura configurable (lo que pediste)

Cada componente es un **término configurable** vía Config Engine, no una constante:

```typescript
// Todos resueltos por el Config Engine (platform→tenant→region→merchant), versionados
type ProfitabilityConfig = {
  commission: RateRule;          // % por categoría/merchant/zona
  deliveryPricing: RateRule;     // tarifa por zona/distancia/horario
  pspFee: RateRule;              // % + fijo del PSP
  subsidyPolicy: SubsidyRule;    // quién financia bonificaciones de delivery/promo
  adsSaasProration: ProrationRule;
  aiCostSource: 'agent-core-gasto'; // se lee del GastoStore de agent-core
};
```

- El motor **calcula y alerta**, no bloquea ventas salvo reglas explícitas (fiel a la
  sección 8). Ej.: alerta "este pedido tiene contribución negativa" sin frenarlo, salvo
  que el tenant configure una regla de bloqueo.
- El **costo de IA** ya está resuelto: agent-core atribuye gasto de IA por tenant/agente
  (`GastoStore`). El Profitability Engine lo **lee**, no lo estima.

---

## Merchant Simulator (punto 6 del brief)

**Inputs** (config editable por el comercio): ventas actuales, ticket, margen, comisión,
crecimiento, pedidos, costos de pago, suscripción, delivery subsidiado, publicidad.

**Outputs**: ventas incrementales, comisión, costos, **pedidos necesarios para cubrir la
plataforma** (break-even), contribución incremental, ROI estimado.

**Tres escenarios** (sección 9):
1. Sin plataforma (baseline del comercio).
2. Con plataforma (comisión + delivery + ventas incrementales).
3. Con plataforma + Agent Core (uplift por recompra/recomendación del agente).

### Advertencias de honestidad (para no vender humo)

- El escenario 3 ("+Agent Core") **no puede prometer** un uplift inventado. Debe ser un
  **modelo transparente con supuestos que el comercio puede editar** (ej. "+X% de
  recompra", "+Y% de ticket por recomendación"), etiquetados como *estimación*, no
  promesa. El doc mismo dice "guardar simulaciones y modificar supuestos" — bien.
- Las "ventas incrementales" son proyección, no hecho. La UI debe dejarlo claro.
- El mensaje comercial (sección 9) — "cuánto valor adicional podés obtener, no cuánto te
  cobramos" — es correcto siempre que los supuestos sean editables y visibles.

**Persistencia:** `Simulation` + `SimulationScenario` (ya en el modelo del doc, sección
12). Cada simulación guarda sus supuestos para auditar el pitch.
