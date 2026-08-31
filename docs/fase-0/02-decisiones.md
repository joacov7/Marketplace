# C + L — Decisiones a tomar y preguntas abiertas

Estas son las decisiones con impacto en **arquitectura, dinero, seguridad o
escalabilidad**. Como pediste, no las tomo en silencio: presento alternativas y
recomiendo una. Las que dependen de información que solo vos tenés están en la
sección **L (Preguntas)** al final.

> ## ✅ Estado tras tus respuestas L1–L9 (2026-08-31)
>
> **CERRADAS y confirmadas:** D1 (ciudad = región; White Label 3ro = tenant nuevo),
> D2 (Agent Core in-process/desacoplado, expone tools/APIs/eventos), D3 (Customer Agent
> propiedad de Commerce OS sobre runtime de agent-core), D4 (RLS + contexto), D7
> (dinero en enteros/centavos), D8 (config tipada + reglas acotadas), D9 (Node/TS), D10
> (core agnóstico + módulos de vertical), D11 (fórmula corregida).
>
> **CERRADAS con matices tuyos:**
> - **D5 (pagos):** V1 = Pet Shop propio, pago a la operación, **sin marketplace**.
>   V2 = comercios externos vía **OAuth**, evaluar **Mercado Pago Split 1:1**, el
>   comercio recibe su parte y la plataforma su comisión. Payment Orchestrator con
>   `PaymentProvider` para no atarse a MP. Todo esto **queda diseñado** (ver
>   [05-pagos-y-economia.md](05-pagos-y-economia.md) y [11-cierre.md](11-cierre.md)).
> - **L1 (entidad legal):** V1 modela el Pet Shop propio como **Commerce/Tenant
>   independiente** aunque legalmente sea la misma sociedad. Jerarquía
>   `Plataforma → Tenant/Commerce(Pet Shop) → …`. **No** se crea una segunda sociedad
>   para V1.
> - **L4 (comisión/delivery):** **7% base como parámetro** (no constante), delivery por
>   zona/distancia/modalidad, subsidio configurable. Los escenarios 5/7/10% ya están
>   **calculados** (ver [11-cierre.md](11-cierre.md) §Profitability).
>
> **PENDIENTES — necesitan definición futura, NO bloquean la Fase 1:**
> - **[VALIDACIÓN PROFESIONAL — contador/abogado AR]** Todo lo fiscal: quién es el
>   vendedor de registro y quién factura en V1 (misma sociedad opera plataforma +
>   Pet Shop), tratamiento de IVA/IIBB, y —para V2— si el esquema MP Split 1:1 evita
>   que la plataforma quede como agregador/intermediario de pagos. El **software no
>   asume** ninguna postura fiscal: `InvoiceIssuer` y el "quién-factura-a-quién" son
>   configurables. **Marcado para validar antes de producción.**
> - **[L4 números finales]** Los % definitivos de comisión y las políticas de subsidio
>   se fijan como **config** tras revisar los escenarios; no hace falta para arrancar.
> - **[L2 acceso MP]** Confirmar a futuro qué producto MP Split queda habilitado (V2).

Cada decisión tiene una recomendación. Debajo queda el detalle y el razonamiento.

---

## D1 — Ciudad: ¿tenant o región dentro de un tenant?

- **Contexto.** El roadmap mezcla "otras ciudades" (V5) y "White Label para terceros"
  (V5) como si fueran lo mismo. No lo son (ver [MT1]).
- **Alternativas.**
  - **A) Ciudad = región dentro del tenant.** Un operador/marca maneja N ciudades bajo
    un dominio raíz, con catálogo y config heredables y zonas de delivery por región.
  - **B) Ciudad = tenant separado.** Cada ciudad es un tenant aislado.
- **Recomendación: A.** El operador de Gualeguay que abre en otra ciudad es la misma
  marca; quiere reusar catálogo, administración y branding. El aislamiento total (B)
  duplicaría todo sin beneficio. El **White Label de un tercero sí es un tenant nuevo**
  (operador, marca, dominio y aislamiento distintos). Jerarquía:
  `Plataforma > Tenant > Región > Merchant > Usuario`.
- **Impacto:** modelo de datos + Config Engine. Alto si se cambia después.

## D2 — Integración con Agent Core: ¿SDK in-process o servicio remoto?

- **Contexto.** agent-core hoy es un **monorepo de paquetes TypeScript** que las apps
  consumen **in-process**: la app implementa *providers* (adaptadores dominio→canónico)
  e inyecta el runtime. No es un servicio HTTP.
- **Alternativas.**
  - **A) In-process (SDK).** Commerce OS depende de `@agent-core/contracts`, implementa
    los providers de comercio (catálogo, inventario, pipeline, logística, contactos) e
    invoca el runtime en el mismo proceso. Sin hop de red, sin serialización, sin
    versionado de API remota.
  - **B) Servicio remoto (API/eventos).** agent-core deployado aparte, Commerce OS le
    habla por HTTP/eventos.
- **Recomendación: A para V1**, con la frontera limpia para poder pasar a B después.
  La separación conceptual "Agent Core independiente" **no requiere** distribución
  física: se logra dependiendo solo de `contracts` e inyectando providers. Distribuir
  en V1 agrega latencia, operación y un contrato de red que todavía no necesitás. Cuando
  Agent Core sea un producto vendido a terceros (o el volumen lo pida), se expone como
  servicio **sin reescribir** los agentes (solo cambia el transporte de los providers).
- **Consecuencia sobre el stack:** empuja fuerte a **Node/TypeScript** en Commerce OS
  (mismo runtime → integración trivial). Ver E en [03-arquitectura.md](03-arquitectura.md).
- **Impacto:** define stack y forma de integración. Ver D9.

## D3 — ¿De quién es el Customer Shopping Agent?

- **Contexto.** Los 22 agentes de agent-core son *merchant-facing*. El agente del
  cliente es *customer-facing*, con un modelo de autorización distinto ([S2]). Y me
  pediste **no tocar agent-core**.
- **Alternativas.**
  - **A) Agente propiedad de Commerce OS**, construido *sobre* el runtime de agent-core
    (enforcement, presupuesto, memoria, tools). No agrega nada al catálogo de
    agent-core.
  - **B) Nuevo agente en el catálogo de agent-core** (customer-facing genérico,
    reutilizable por otros verticales).
- **Recomendación: A para V1** (respeta "no tocar agent-core" y evita comprometer el
  catálogo con un arquetipo nuevo antes de validarlo). Se compone de primitivas de
  agent-core: actor `usuario:cliente`, tools de solo-lectura + preparación, autonomía
  tope `assisted`, presupuesto por tenant. Si más adelante se prueba reutilizable, se
  *promueve* al catálogo de agent-core (decisión futura, con vos y el owner de
  agent-core).
- **Impacto:** bajo; es dónde vive el código, no cómo funciona.

## D4 — Enforcement del aislamiento multi-tenant

- **Contexto.** [S1]. Es la decisión #1 de seguridad.
- **Alternativas.**
  - **A) Postgres Row-Level Security (RLS)** + contexto de tenant por transacción.
    La base niega filas de otros tenants aunque el código olvide filtrar.
  - **B) Schema por tenant.** Un schema Postgres por tenant. Aislamiento fuerte pero
    migraciones y conexiones se complican con muchos tenants; caro operar a escala.
  - **C) Solo a nivel aplicación** (`WHERE tenant_id`). Simple pero frágil: un olvido =
    fuga.
- **Recomendación: A (RLS) como enforcement de base + disciplina de contexto en la app
  (defensa en profundidad).** B se reserva para un tenant enterprise que exija
  aislamiento físico (posible a futuro, no default). C nunca solo.
- **Impacto:** elección de ORM/driver (debe soportar `SET LOCAL` / session vars). Alto,
  se decide ahora.

## D5 — Modelo de cobro marketplace (fiscal + PSP) — **requiere tu input**

- **Contexto.** En marketplace (V2), la plata del cliente no es toda de la plataforma
  ([D3$], sección 10 del doc). Dos formas con Mercado Pago:
  - **A) MP Marketplace / split ("connect"):** cada comercio conecta su cuenta MP
    (OAuth); MP cobra al cliente, acredita al comercio y retiene tu comisión (marketplace
    fee). La plataforma **no toca** la plata del comercio → menor riesgo fiscal/legal.
  - **B) Plataforma como agregador:** la plataforma cobra todo a su cuenta y luego hace
    payouts a los comercios. Te convierte en intermediario de pagos → implicancias
    fiscales/regulatorias fuertes ("cobrar por cuenta y orden").
- **Recomendación: A (MP Marketplace/connect)** para evitar la carga de ser agregador,
  **sujeto a validación fiscal profesional** (como pide el doc). En **V1 (pet shop
  propio)** el punto es simple: la plata va a la cuenta propia de la operación; pero el
  **modelo de datos ya usa ledger + allocations** para que V2 no obligue a rehacer.
- **Lo que necesito de vos:** ver preguntas L2–L4.

## D6 — Responsabilidad de facturación (quién factura a quién) — **requiere tu input**

- **Contexto.** [D3$]. Difiere entre propio y marketplace.
- **Recomendación:** módulo `Billing` con abstracción `InvoiceIssuer` (impl. AFIP/ARCA)
  y el *quién-factura-a-quién* como config por tenant/modelo. Lógica fiscal marcada para
  validación profesional; **no** se hardcodea en V1.
- **Lo que necesito de vos:** L1.

## D7 — Representación del dinero

- **Recomendación (no-negociable):** enteros en unidad mínima (centavos) + `currency`.
  Nunca float. Ledger de doble partida. Re-cotización a precio actual en "repetir
  compra". Ver [D1$].
- **Impacto:** bajo ahora, irreversible si se elige mal.

## D8 — Alcance del Configuration/Rules Engine en V1

- **Contexto.** [C1] (necesitamos motor) vs [C2] (no sobre-construir un DSL).
- **Alternativas.**
  - **A) Config tipada + versionada + primitivas de regla declarativas acotadas** (sobre
    atributos conocidos: zona, monto, horario, categoría, cliente).
  - **B) Motor de reglas genérico / mini-lenguaje** configurable por el tenant.
- **Recomendación: A.** Cubre precios/promos/delivery/comisiones sin un DSL. Si algo no
  entra en las primitivas, es señal de que necesita código + decisión, no un lenguaje.
- **Impacto:** acota alcance; positivo.

## D9 — Stack

- **Recomendación:** **Node.js + TypeScript** en todo Commerce OS. Razón principal:
  integración in-process con agent-core (D2) sin serialización ni servicio aparte, y un
  solo lenguaje/tooling en todo el sistema. Detalle y justificación por capa (framework,
  DB, cache, colas, storage, auth, pagos, mapas, notificaciones, observabilidad, CI/CD,
  hosting) en [03-arquitectura.md](03-arquitectura.md) sección E.
- **Impacto:** define todo el tooling. Alto.

## D10 — Extensibilidad de verticales

- **Contexto.** [A3]. "Otro vertical sin código" es parcial.
- **Recomendación:** **core de comercio agnóstico + módulos de vertical** (tablas +
  config + UI propios). Pet shop = primer módulo de vertical (`Pet`, perfil, recompra
  por mascota). No un modelo EAV genérico. Multi-vertical real (V6) = agregar módulos,
  no reescribir core.
- **Impacto:** fronteras de módulos. Medio.

## D11 — Corrección de la fórmula de rentabilidad

- **Recomendación:** adoptar las **dos fórmulas separadas** (contribución de plataforma
  vs contribución del comercio) de [D-ERR]. El GMV es base de comisión y métrica, nunca
  sumando. Detalle en [05-pagos-y-economia.md](05-pagos-y-economia.md).
- **Impacto:** ninguno de infra; corrige el modelo antes de codificar.

---

## Tabla resumen de decisiones

| ID | Decisión | Recomendación | Versión | Necesita tu input |
|----|----------|---------------|---------|-------------------|
| D1 | Ciudad = tenant o región | Región dentro del tenant | V1 | Confirmar |
| D2 | Integración Agent Core | SDK in-process | V1 | Confirmar |
| D3 | Dueño del Customer Agent | Commerce OS sobre runtime agent-core | V1 | Confirmar |
| D4 | Aislamiento multi-tenant | Postgres RLS + contexto | V1 | Confirmar |
| D5 | Cobro marketplace | MP Marketplace/connect (+validación fiscal) | V2 (modelo V1) | **Sí (L2–L4)** |
| D6 | Facturación | Módulo Billing + `InvoiceIssuer`, config | V1 abstracción | **Sí (L1)** |
| D7 | Dinero | Enteros centavos + moneda | V1 | Confirmar |
| D8 | Config/Rules Engine | Config tipada + primitivas acotadas | V1 | Confirmar |
| D9 | Stack | Node + TypeScript | V1 | Confirmar |
| D10 | Verticales | Core agnóstico + módulos de vertical | V1 | Confirmar |
| D11 | Fórmula rentabilidad | Dos P&L separados | V1 | Confirmar |

---

## L — Preguntas que necesito que resuelvas

Estas bloquean o condicionan el diseño de dinero/fiscal. No las puedo decidir yo.

1. **[L1] Estructura societaria/fiscal en V1.** El "pet shop propio de Gualeguay":
   ¿es la **misma** entidad legal que la plataforma, o una entidad separada? Esto define
   quién es el **vendedor de registro**, quién **factura al cliente** y a qué cuenta
   entra la plata en V1.
2. **[L2] Acceso a Mercado Pago.** ¿Qué producto de MP tenés/podés tener?
   (Checkout Pro / Checkout API / **Marketplace/split**). Determina si el flujo
   marketplace (V2) es MP connect o agregador.
3. **[L3] ¿La plataforma quiere alguna vez *tocar* la plata de comercios externos**
   (cobrar todo y hacer payouts), o preferís que MP acredite directo al comercio y vos
   solo retengas comisión? (Riesgo fiscal muy distinto — D5.)
4. **[L4] Comisión y delivery en V1.** ¿Qué números manejás de comisión (%), costo de
   delivery y quién subsidia qué? El Simulador y el Profitability Engine los necesitan
   como config inicial (no van hardcodeados, pero necesito valores de arranque).
5. **[L5] Multi-ciudad: ¿misma marca/dominio o distintos?** Confirma D1.
6. **[L6] ¿El agente del cliente debería alguna vez comprar solo** (con un tope de
   gasto), o **siempre** confirma el humano? Recomiendo siempre confirmar para acciones
   de dinero (S2); confirmame si coincidís.
7. **[L7] Timeline/presupuesto de V1** y si hay fecha para la primera venta real. Define
   cuánto del roadmap entra en la primera entrega.
8. **[L8] ¿App nativa en el horizonte o PWA es suficiente por ahora?** (El doc dice
   PWA-first; asumo PWA para V1 y nativas diferidas.)
9. **[L9] Volumen esperado en V1** (pedidos/día, catálogo aprox., cantidad de comercios
   propios). Calibra si el outbox in-process alcanza o hay que planear el broker antes.

---

## ADRs (Architecture Decision Records) — versión inicial

Los ADR formales viven en `docs/DECISIONS.md` (que el doc manda mantener). Acá quedan
enunciados; se formalizan al cerrar las decisiones de arriba.

- **ADR-001** Arquitectura: Modular Monolith con límites enforced (linter + tablas por
  módulo + eventos). → [03-arquitectura.md](03-arquitectura.md)
- **ADR-002** Aislamiento multi-tenant por Postgres RLS + contexto obligatorio (falla
  cerrado). → D4
- **ADR-003** Integración Agent Core in-process vía contracts + providers. → D2
- **ADR-004** Dinero como enteros en unidad mínima + moneda + ledger de doble partida. → D7
- **ADR-005** Jerarquía de tenancy de 5 niveles; ciudad = región. → D1
- **ADR-006** Stack Node/TypeScript. → D9
- **ADR-007** Modelo Order/SellerOrder/Payment/Allocation/Delivery/Route con "1 pedido =
  1 comercio" como config, no código. → [04-modelo-de-datos.md](04-modelo-de-datos.md)
- **ADR-008** Configuration Engine tipado + versionado + primitivas de regla acotadas
  (sin DSL). → [07-configuracion.md](07-configuracion.md)
- **ADR-009** Payment Orchestrator con `PaymentProvider` abstraction; MP como primera
  impl. → [05-pagos-y-economia.md](05-pagos-y-economia.md)
- **ADR-010** Core de comercio agnóstico + módulos de vertical (Pet como primero). → D10
