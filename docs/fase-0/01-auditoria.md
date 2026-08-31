# A + B — Auditoría: problemas y mejoras

Cada hallazgo sigue el formato pedido: **problema → por qué importa → solución →
versión afectada → impacto técnico**. Ordenados por la prioridad acordada
(seguridad → dinero → multi-tenancy → configurabilidad → mantenibilidad →
escalabilidad → UX). El `[ID]` se referencia desde el resto del informe.

Lo que el documento **ya hace bien** (y no hay que tocar) está listado al final, para
no dar la impresión de que todo son problemas: no lo son.

---

## SEGURIDAD

### [S1] El documento *promete* aislamiento multi-tenant pero no define *cómo se fuerza*

- **Problema.** La sección 15 dice "Tenant isolation probado automáticamente" y el
  criterio de aceptación pide "datos y métricas aislados por tenant", pero en ningún
  lado se define el **mecanismo de enforcement**. Aislar por `WHERE tenant_id = ?` en
  cada query, escrito a mano, es la causa #1 de fugas cross-tenant en SaaS
  multi-tenant: alcanza con que **un** desarrollador olvide el `WHERE` una vez.
- **Por qué importa.** Es la falla más cara y más difícil de detectar: no rompe tests
  felices, filtra datos de un cliente a otro en producción. Cae en la máxima prioridad
  (seguridad) y además es la promesa central del producto White Label.
- **Solución.** Defensa en profundidad, no confianza en el `WHERE`:
  1. **Postgres Row-Level Security (RLS)** con una política que fuerce
     `tenant_id = current_setting('app.tenant_id')` en cada tabla. Aunque el código
     olvide filtrar, la base niega las filas de otros tenants. *(Recomendado — ver D4.)*
  2. Un **contexto de request obligatorio** (igual que el `TenantCtx` de agent-core:
     sin tenant, no ejecuta — *falla cerrado*) que setea `app.tenant_id` por conexión/
     transacción.
  3. **Tests de aislamiento** como ciudadanos de primera clase (ver
     [08-seguridad-testing.md](08-seguridad-testing.md)): por cada entidad, un test que
     prueba que el tenant B no puede leer/escribir datos del tenant A.
- **Versión.** V1 — no es retrofit-eable barato. Se decide ahora.
- **Impacto técnico.** Elección de ORM/driver que soporte RLS y session vars (Postgres
  + Prisma/Drizzle con `SET LOCAL`), y un middleware de contexto. Alto valor, costo
  medio si se hace desde el inicio; costo altísimo si se agrega después.

### [S2] El modelo de autorización del *Customer Shopping Agent* no está definido — y es un umbral de confianza distinto al de los agentes del comercio

- **Problema.** El v3 dice "el agente no debe poder realizar acciones sensibles sin
  autorización" (bien) pero trata al agente del cliente como si fuera del mismo tipo
  que los agentes del comercio. No lo es: el agente del cliente **actúa por cuenta de
  un comprador anónimo o semi-anónimo**, no de un operador del tenant. La pregunta
  crítica —¿el agente puede *gastar plata* del cliente?— no tiene respuesta explícita.
- **Por qué importa.** Un agente que puede completar un checkout o disparar una
  recompra sin confirmación humana es un riesgo de dinero y de confianza directo
  (cobros no deseados → contracargos → daño reputacional). Es exactamente el tipo de
  cosa que hunde la percepción del producto.
- **Solución.** Frontera dura **propose-only para acciones de dinero**: el agente
  puede *armar* el carrito, recomendar, comparar, detectar recompra y *preparar* la
  orden, pero **jamás** confirmar pago o crear un pedido sin confirmación humana
  explícita. Esto se mapea 1:1 al enforcement que **ya existe** en agent-core
  (`manual` / `assisted` / `autonomous` + intercepción de toda tool de escritura). Para
  el agente del cliente: autonomía tope = `assisted` en lectura/armado, y las tools de
  escritura que tocan dinero (`checkout`, `pay`, `place_order`) **no se le exponen** o
  requieren un token de confirmación del usuario. Detalle en
  [06-agentes-ia.md](06-agentes-ia.md).
- **Versión.** V1 (el agente es visible desde el inicio).
- **Impacto técnico.** Bajo si se reutiliza el enforcement de agent-core; se define un
  actor `usuario:cliente` con scope acotado y un catálogo de tools de solo-lectura +
  "preparación".

### [S3] Secretos y credenciales de pago son *por-tenant/por-merchant*, no globales

- **Problema.** "Nunca almacenar secretos en código" (sección 15) es correcto pero
  insuficiente. En el modelo marketplace, **cada comercio conecta su propia cuenta de
  Mercado Pago** (o la plataforma cobra por cuenta y orden). Eso significa N credenciales
  y N secretos de webhook, uno por merchant, que hay que guardar cifrados y rotar.
- **Por qué importa.** Un secreto de MP filtrado = acceso a la plata de un comercio.
  Guardarlos mal (en config plana, sin cifrar) es una brecha de dinero.
- **Solución.** Un **secret store por-tenant/por-merchant** (columna cifrada con
  envelope encryption vía KMS, o un secrets manager). Nunca en `TenantConfig` plano.
  El modelo de datos debe tener un lugar tipado para "credencial de proveedor de pago
  del merchant" separado de la config comercial.
- **Versión.** V1 la abstracción; el multi-merchant real es V2, pero el *lugar* se
  reserva ahora.
- **Impacto técnico.** Medio. Integración con KMS/Secrets Manager desde el inicio.

### [S4] PII sensible (datos de mascotas/salud, direcciones) sin mención de protección de datos

- **Problema.** El producto guarda perfil de mascota (potencialmente datos de salud:
  medicación, dieta), direcciones y hábitos de compra. La Ley 25.326 (Argentina) y
  buenas prácticas de minimización no se mencionan.
- **Por qué importa.** Riesgo legal y de confianza; barato de contemplar ahora, caro de
  retrofit-ear (borrado, export, consentimiento).
- **Solución.** Minimización + campos de PII marcados + soporte de borrado/export por
  cliente (derecho de acceso/supresión) + no loguear PII. No es un módulo grande en V1,
  es una disciplina de modelado.
- **Versión.** V1 (disciplina), features de export/borrado V2.
- **Impacto técnico.** Bajo si se marca desde el modelo.

---

## DINERO

### [D-ERR] La fórmula del Profitability Engine está mal: mezcla dos P&L distintos y suma el GMV como si fuera ingreso

- **Problema (error concreto).** La sección 8 define:

  > `GMV + comisión + margen logístico + publicidad/SaaS − PSP − cadete − promociones − IA − otros = contribución`

  Esto está **incorrecto**. El **GMV** (valor total transado) **no es ingreso de la
  plataforma**; en un marketplace/intermediación la plataforma se queda con la
  *comisión* + *margen logístico* + *ads/SaaS*, no con el GMV. Sumar GMV como término
  positivo **sobreestima la contribución en un orden de magnitud**. Además la fórmula
  **mezcla el P&L de la plataforma con el del comercio**: `comisión` es un *ingreso*
  para la plataforma pero un *costo* para el comercio; no pueden estar en la misma
  ecuación con el mismo signo.
- **Por qué importa.** Es el motor que decide si un pedido es rentable y alimenta el
  Simulador comercial. Si la fórmula está mal, todas las decisiones económicas y el
  pitch a los comercios están mal. Es dinero, segunda prioridad.
- **Solución.** Separar **dos vistas** explícitas (detalle en
  [05-pagos-y-economia.md](05-pagos-y-economia.md)):

  **Contribución de la plataforma (por pedido):**
  ```
  = comisión_sobre_GMV
  + margen_logístico            (lo cobrado por delivery − costo real del cadete)
  + ingresos_ads + ingresos_saas_prorrateado
  − fees_PSP
  − subsidio_delivery_financiado_por_plataforma
  − promociones_financiadas_por_plataforma
  − costo_IA
  − otros_costos_plataforma
  ```
  El **GMV es la base de cálculo de la comisión y una métrica de reporte, nunca un
  sumando.**

  **Contribución del comercio (la que muestra el Simulador, vista comercio):**
  ```
  = ventas_incrementales (GMV del comercio vía plataforma)
  − comisión
  − costo_productos (CMV)
  − delivery_a_cargo_del_comercio
  − promociones_financiadas_por_comercio
  ```
- **Versión.** V1 (el Profitability Engine y el Simulador son V1).
- **Impacto técnico.** Ninguno de infraestructura; es corregir el modelo de cálculo
  antes de codificarlo. Crítico hacerlo ahora.

### [D1$] El dinero no puede representarse con float, y falta definir moneda + inflación

- **Problema.** No se especifica la representación monetaria. En un contexto ARS con
  inflación alta, usar floats produce errores de centavos que rompen la conciliación y
  el ledger. Además "repetir compra" con precios viejos es incorrecto bajo inflación.
- **Por qué importa.** Errores de redondeo en un ledger de doble partida = conciliación
  imposible = dinero perdido/mal atribuido. Dinero, alta prioridad.
- **Solución.** **Enteros en unidad mínima (centavos) + código de moneda** en toda
  entidad monetaria (`amount_minor: bigint`, `currency: 'ARS'`). Nunca float. "Repetir
  compra" **re-cotiza a precio actual** y muestra el delta al cliente. Ver D7.
- **Versión.** V1, no-negociable.
- **Impacto técnico.** Bajo, pero irreversible si se elige mal: migrar montos después
  es doloroso.

### [D2$] Idempotencia y conciliación mencionadas pero sin las dos claves separadas

- **Problema.** La sección 10 dice "idempotencia" en general. Hay **dos** puntos de
  idempotencia distintos que hay que tratar por separado: (a) el **checkout** (evitar
  doble pedido si el cliente toca "pagar" dos veces → idempotency key generada por el
  cliente), y (b) el **procesamiento de webhooks** (evitar procesar el mismo evento de
  MP dos veces → dedupe por `provider_event_id`). El criterio de aceptación "webhook
  repetido no duplica pagos/pedidos" solo cubre (b).
- **Por qué importa.** Doble cobro o doble pedido es el peor bug de un commerce.
- **Solución.** Idempotency key en la API de checkout (`Idempotency-Key` header,
  almacenada con la respuesta) + tabla de eventos de webhook procesados con unique
  constraint sobre `provider_event_id`. Detalle en [09-api.md](09-api.md).
- **Versión.** V1.
- **Impacto técnico.** Bajo, pero hay que diseñarlo, no improvisarlo.

### [D3$] Falta el modelo fiscal/de facturación como *branch* de arquitectura (no solo "validar con contador")

- **Problema.** El v3 (correctamente) difiere las decisiones fiscales a validación
  profesional. Pero arquitectónicamente falta reconocer que **quién factura a quién
  cambia entre "propio" y "marketplace"**: en V1 (pet shop propio) la plataforma
  factura al cliente; en marketplace (V2) el **comercio** factura al cliente y la
  **plataforma factura al comercio** la comisión. Son dos flujos de facturación
  distintos.
- **Por qué importa.** Si Billing asume el flujo V1 (plataforma factura todo), migrar a
  marketplace obliga a rehacerlo. Es dinero + fiscal.
- **Solución.** Módulo `Billing` con **abstracción de emisor de factura** (igual que el
  Payment Orchestrator abstrae el PSP): `InvoiceIssuer` con implementación AFIP/ARCA, y
  el *quién factura a quién* configurable por tenant/modelo. No se implementa la lógica
  fiscal en V1, pero la **forma** del módulo se define ahora. Marcar para validación
  profesional (como pide el doc).
- **Versión.** Abstracción V1; implementación marketplace V2. Requiere input tuyo (ver
  L en [02-decisiones.md](02-decisiones.md)).
- **Impacto técnico.** Medio.

---

## MULTI-TENANCY

### [MT1] Ambigüedad Tenant vs Merchant vs Ciudad — la jerarquía no está definida

- **Problema.** El modelo tiene `Tenant` y `Merchant` como entidades separadas (bien),
  pero no define la **relación** ni dónde encaja la **ciudad**. El doc habla de
  "replicarse en otras ciudades" (V5) y "White Label para terceros" (V5) como si fueran
  lo mismo, y no lo son:
  - *Pet shop propio en Gualeguay* → 1 plataforma, 1 tenant, N merchants propios.
  - *Otra ciudad* → ¿nuevo tenant, o región del mismo tenant?
  - *White Label para un tercero* → definitivamente un tenant nuevo (marca/dominio/
    operador distinto).
- **Por qué importa.** Define el aislamiento de datos, la herencia de configuración, los
  dominios y el reuso de catálogo. Si "ciudad = tenant", no podés compartir catálogo ni
  administración entre ciudades de la misma marca; si "ciudad = tenant" mal elegido,
  duplicás todo. Es la columna vertebral del multi-tenant.
- **Solución (recomendada — ver D1).** Jerarquía explícita de 5 niveles:
  `Plataforma > Tenant (operador/marca) > Región (ciudad) > Merchant (vendedor) > Usuario`.
  - **Ciudad = Región dentro de un tenant** (mismo operador, misma marca, mismo dominio
    raíz, catálogo y config heredables, zonas de delivery por región).
  - **White Label de un tercero = Tenant nuevo** (operador distinto, aislamiento total).
  Esta jerarquía es también el eje del Configuration Engine (herencia de config).
- **Versión.** V1 (aunque V1 tenga 1 tenant + 1 región + N merchants propios, el modelo
  soporta los 5 niveles desde el inicio).
- **Impacto técnico.** Medio; es sobre todo modelado + el Config Engine. Ver
  [07-configuracion.md](07-configuracion.md).

---

## CONFIGURABILIDAD

### [C1] "Todo configurable" se enuncia pero no hay Configuration Engine especificado

- **Problema.** El principio "configuration first" es el corazón del producto, pero el
  v3 no define **el motor**: herencia, precedencia de overrides, versionado, auditoría,
  tipado/validación de la config, y la diferencia entre *feature flags* vs *config* vs
  *reglas*. La sección 13 solo dice "la plantilla define defaults, todo modificable".
- **Por qué importa.** Sin un motor real, "configurable" degenera en (a) tablas de
  config ad-hoc sin validación que rompen en runtime, o (b) `if tenant == X` disfrazado.
  Es la promesa de "desarrollar una vez".
- **Solución.** Un Configuration Engine con: resolución por herencia
  (Plataforma→Tenant→Región→Merchant→Usuario, gana el más específico), config **tipada
  y validada** por JSON Schema (agent-core ya usa este patrón), feature flags como
  subtipo, **versionado + auditoría + effective-dating** (crítico: cambiar una comisión
  o un precio es una acción de dinero, debe quedar registrada y datada). Diseño completo
  en [07-configuracion.md](07-configuracion.md).
- **Versión.** V1 (es infraestructura base).
- **Impacto técnico.** Medio-alto: es un componente central. Pero es *la* inversión que
  evita reconstruir.

### [C2] Riesgo opuesto: sobre-configurabilidad / motor de reglas Turing-completo

- **Problema.** El impulso de "todo configurable" lleva a construir un motor de reglas
  genérico (un mini-lenguaje) para precios/promos/delivery. Eso es un proyecto entero,
  una fuente de bugs y un agujero de seguridad (ejecutar reglas arbitrarias).
- **Por qué importa.** Complejidad innecesaria — el doc mismo lista "complejidad" como
  riesgo. Un DSL genérico en V1 contradice "MVP simple".
- **Solución.** Config **tipada + un conjunto acotado de primitivas declarativas** de
  regla (condiciones sobre atributos conocidos: zona, monto, horario, categoría), **no**
  un DSL/scripting. Si una regla no entra en las primitivas, es señal de que necesita
  código (y una decisión), no un lenguaje. Ver [07-configuracion.md](07-configuracion.md).
- **Versión.** V1 (definir el límite ahora).
- **Impacto técnico.** Reduce alcance; positivo.

---

## MANTENIBILIDAD / ARQUITECTURA

### [A1] Modular monolith: correcto, pero faltan los mecanismos que evitan que se pudra

- **Problema.** La recomendación de modular monolith (sección 11) es **la correcta**
  (ver [03-arquitectura.md](03-arquitectura.md)), pero "límites de dominio claros" sin
  enforcement se degrada en un big ball of mud, y entonces sí hay que rehacer para
  escalar.
- **Por qué importa.** El valor del modular monolith frente a microservicios depende
  *enteramente* de que los límites se respeten. Si no, tenés lo peor de ambos.
- **Solución.** Enforcement de límites: (a) cada módulo **es dueño de sus tablas**;
  ningún otro módulo las accede por SQL — se pasa por su interfaz pública; (b) un
  **dependency-linter** (eslint boundaries / import-boundaries) que falla el build si un
  módulo importa internals de otro; (c) comunicación cross-módulo vía **eventos**
  (outbox transaccional), no llamadas directas a la DB ajena. Esto es lo que permite
  extraer un módulo a servicio en V2+ sin cirugía.
- **Versión.** V1.
- **Impacto técnico.** Bajo (configuración de linter + disciplina), alto retorno.

### [A2] El "Event Bus/Queue" del diagrama no debe ser un broker real en V1

- **Problema.** La sección 11 pone "Event Bus/Queue" en la arquitectura. Leerlo como
  "necesito Kafka/RabbitMQ en V1" es sobre-ingeniería.
- **Por qué importa.** Un broker distribuido en V1 agrega operación, latencia y modos de
  falla sin necesidad. Pero *sí* se necesita consistencia entre pedido/pago/delivery.
- **Solución.** **Transactional outbox** in-process: el evento se escribe en la misma
  transacción que el cambio de estado, y un worker lo publica async. En V1 el "bus" es
  una tabla + worker; los **contratos de evento** se definen ahora para poder cambiar a
  un broker real en V2 sin tocar productores/consumidores. Ver
  [04-modelo-de-datos.md](04-modelo-de-datos.md) (modelo de eventos).
- **Versión.** V1 outbox; broker cuando el volumen lo justifique.
- **Impacto técnico.** Bajo, y resuelve consistencia (evita el dual-write pedido↔pago).

### [A3] "Vertical agnostic" tiene un límite que el doc no reconoce: entidades de dominio propias

- **Problema.** El principio "vertical agnostic" y el roadmap V6 ("otro vertical sin
  código") son **parcialmente** ciertos. Branding, reglas, módulos y textos sí se
  resuelven por config. Pero un vertical con **entidades de dominio propias** no:
  `Pet` / perfil de mascota / "recompra por mascota" son específicos de pet shop. Una
  ferretería no tiene mascotas. Agregar un vertical con entidades nuevas **no es
  solo config**.
- **Por qué importa.** Vender "cualquier vertical sin tocar código" como absoluto lleva
  a un modelo de datos genérico tipo EAV (lento, sin integridad) o a promesas que no se
  cumplen. Honestidad arquitectónica.
- **Solución.** Separar **core de comercio (agnóstico)** de **módulos de vertical
  (con sus tablas + config + UI)**. El core (catálogo, carrito, órdenes, pagos,
  delivery, tenancy, config) es agnóstico. Pet shop es un **módulo de vertical** que
  agrega `Pet`, perfil y recompra-por-mascota. Agregar "ferretería" = un módulo nuevo
  (poco código, aislado), no reescribir el core. Config-only cubre marca/reglas/módulos;
  entidades nuevas = módulo de vertical. Ver [04-modelo-de-datos.md](04-modelo-de-datos.md).
- **Versión.** V1 define la frontera; Pet como primer módulo de vertical. Multi-vertical
  real V6.
- **Impacto técnico.** Medio; sobre todo es una decisión de fronteras.

---

## ESCALABILIDAD / EVOLUCIÓN

### [E1] El modelo Order/Delivery/Payment a prueba de multi-seller: el esqueleto está bien, faltan invariantes

- **Problema.** El criterio "la estructura futura multi-seller puede agregarse sin
  rehacer Order" es el más importante de evolución, y el doc **ya tiene el esqueleto
  correcto** (`Order` + `SellerOrder` + `OrderItem`; `Payment` + `PaymentAllocation`;
  `Delivery` + `Route` + `DeliveryEvent`). Lo que falta es **precisión sobre las
  relaciones e invariantes**, porque un detalle mal puesto obliga a rehacer.
- **Por qué importa.** Si en V1 los `OrderItem` cuelgan directo de `Order` (y no de
  `SellerOrder`), o el `Delivery` cuelga de `Order` (y no de `SellerOrder`), el
  multi-seller de V4 sí obliga a migrar el corazón del sistema.
- **Solución (invariantes).**
  - `OrderItem` pertenece a **`SellerOrder`**, no a `Order`. (Multi-seller = N
    SellerOrders; V1 = siempre 1.)
  - `Delivery` se asocia a **`SellerOrder`** (una entrega cumple lo de un comercio); un
    `Route` futuro agrupa varias `Delivery`. V1: 1 SellerOrder → 1 Delivery.
  - `Payment` a nivel `Order`; `PaymentAllocation` reparte a cada `SellerOrder` +
    plataforma + delivery + PSP. V1: una allocation al merchant propio.
  - La regla "1 pedido = 1 comercio = 1 entrega" se expresa como **config**
    (`orders.maxSellersPerOrder = 1`), **no** hardcodeada. Prohibido `if`. Cambiar a
    multi-seller = cambiar el flag + activar el flujo de consolidación, sin tocar el
    esquema.
  Detalle y ERD en [04-modelo-de-datos.md](04-modelo-de-datos.md).
- **Versión.** V1 el esqueleto e invariantes; multi-seller V4.
- **Impacto técnico.** Bajo si se hace bien de entrada; altísimo si se corrige después.

---

## FUNCIONALIDADES FALTANTES (gaps del documento)

### [G1] Reserva de stock / oversell concurrente — **crítico y ausente**

- **Problema.** No hay tratamiento de la concurrencia de inventario: dos clientes
  compran la última unidad al mismo tiempo. El doc lista `Inventory` pero no reservas.
- **Por qué importa.** Es un bug de commerce de manual: vender lo que no tenés genera
  cancelaciones, refunds y clientes enojados. Toca dinero e integridad.
- **Solución.** **Reserva de stock en el checkout** con TTL (reserve → confirm on
  payment / release on timeout), atómica a nivel DB (row lock o decremento condicional
  `stock = stock - n WHERE stock >= n`). Ver máquina de estados en
  [04-modelo-de-datos.md](04-modelo-de-datos.md).
- **Versión.** V1.
- **Impacto técnico.** Medio; hay que diseñarlo bien (es fuente de deadlocks si se hace
  mal).

### [G2] Máquina de estados del pedido sin transiciones ni caminos de falla

- **Problema.** Los estados están listados (confirmado→preparando→listo→en camino→
  entregado) pero no las **transiciones permitidas** ni los **caminos de falla**:
  comercio rechaza, sin stock, entrega fallida, cliente cancela, refund. Un pedido no es
  una lista de estados, es una máquina con compensaciones.
- **Por qué importa.** Los caminos de falla son donde se pierde plata y confianza. Sin
  definirlos, cada dev inventa el suyo.
- **Solución.** Máquina de estados explícita con transiciones válidas, actor autorizado
  por transición, y **compensaciones** (rechazo → release de stock + refund;
  entrega fallida → reintento/refund). Diagrama en
  [04-modelo-de-datos.md](04-modelo-de-datos.md).
- **Versión.** V1.
- **Impacto técnico.** Medio.

### [G3] Cancelaciones y devoluciones (más allá del refund parcial)

- **Problema.** El refund parcial es criterio de aceptación, pero el **flujo** de
  cancelación (quién puede cancelar y cuándo, restock, ventana) no está.
- **Solución.** Política de cancelación configurable por estado (antes de "preparando" =
  cancelación libre con refund total; después = según política del tenant) + restock
  automático. Ata con G1/G2.
- **Versión.** V1 (cancelación básica); devoluciones post-entrega V2.
- **Impacto técnico.** Bajo-medio.

### [G4] Onboarding de merchant (KYC + conexión de cuenta de pago) sin lugar en el modelo

- **Problema.** El marketplace (V2) requiere onboarding: KYC del comercio, conexión de
  su cuenta MP (OAuth), acuerdo de comisión. No hay entidades para esto.
- **Solución.** Reservar en el modelo `MerchantOnboarding` / `MerchantPayoutAccount` /
  `CommissionAgreement` (aunque V1 no los use). Ata con S3 y D5.
- **Versión.** Modelo V1 (placeholder), flujo V2.
- **Impacto técnico.** Bajo ahora.

---

## UX

### [U1] El agente visible desde el inicio no debe ejecutarse en cada render (costo/latencia)

- **Problema.** "Acceso visible al agente" en la Home es bueno, pero invocar el LLM en
  cada carga de home es caro (agent-core cobra presupuesto por tenant) y lento.
- **Solución.** Agente **on-demand** (el usuario lo abre) + recomendaciones cacheadas y
  pre-computadas por batch (agent-core ya persiste recomendaciones). El "acceso visible"
  es un botón/entrada, no una llamada al modelo por pageview.
- **Versión.** V1.
- **Impacto técnico.** Bajo; es una decisión de diseño de invocación.

### [U2] "Repetir compra" y "recompra estimada" bajo inflación

- **Problema.** Mostrar/repetir compras con precios históricos en ARS inflacionario
  confunde y puede cobrar de menos/más. (Relacionado a D1$.)
- **Solución.** Re-cotizar siempre a precio actual, mostrar el delta ("subió X% desde tu
  última compra"), y estimar recompra por **cadencia de consumo** (agent-core modela
  cadencia), no por fecha fija.
- **Versión.** V1.
- **Impacto técnico.** Bajo.

---

## Lo que el documento YA hace bien (no tocar)

- **Modular monolith** como arranque, con event bus lógico. Correcto (ver A1/A2 para el
  *cómo*).
- **Esqueleto de datos multi-seller** (Order/SellerOrder/Payment/Allocation/Route).
  Correcto — solo faltan invariantes (E1).
- **Payment Orchestrator con abstracción de proveedor** e "no asumir que un split
  automático resuelve multi-seller". Muy bien visto.
- **Separación Commerce OS ↔ Agent Core** conceptualmente correcta y **alineada con lo
  que agent-core ya es** (runtime, memoria, tools, permisos, auditoría fuera del
  dominio).
- **Complejidad progresiva**: V1 acotada (1 pedido = 1 comercio = 1 entrega) con el
  esqueleto preparado. La decisión es técnicamente correcta (ver
  [03-arquitectura.md](03-arquitectura.md), respuesta directa al punto 3 del brief).
- **PWA-first antes que apps nativas.** Correcto para el mercado y la etapa.
- **No regalar delivery sin fuente de financiación.** Principio económico sano.
- **Diferir decisiones fiscales a validación profesional.** Correcto (solo agrego que la
  *forma* del módulo Billing debe existir igual — D3$).
- **Validar demanda/recompra/economía unitaria/costo logístico antes de escalar**
  (sección 19). Disciplina de negocio correcta.
