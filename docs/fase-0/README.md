# Fase 0 — Revisión crítica de arquitectura

**White Label Commerce OS** · Revisión de CTO / Software Architect / Product Engineer
sobre el *Documento Maestro v3*.

> **Estado:** revisión, **no** implementación. No hay código de aplicación todavía.
> El objetivo de esta fase es encontrar problemas, contradicciones y riesgos, y
> proponer una arquitectura que no haya que reconstruir. La Fase 1 (implementación)
> arranca recién cuando revisemos y cerremos las decisiones de la sección C.

## Sobre qué se hizo esta revisión

- **Documento Maestro v3** (la especificación que pasaste).
- **Código real de `agent-core`** (repo aparte, **no se tocó**): monorepo TypeScript
  maduro, 246 tests, modelo canónico agnóstico de dominio, multi-tenancy obligatorio
  (`TenantCtx` o falla cerrado), enforcement de tools por políticas + autonomía, y un
  AI Gateway con presupuesto por tenant. Buena parte de lo que el v3 pide para "Agent
  Core" **ya existe**; la revisión lo aprovecha en vez de reinventarlo.
- El repo **`Marketplace`** está vacío: es donde vive el Commerce OS. Todo esto son
  documentos de diseño, no código.

## Veredicto en una línea

El documento v3 es **sólido y coherente**: la decisión de modular monolith, el
esqueleto de datos multi-seller (Order/SellerOrder/Payment/Allocation), el Payment
Orchestrator y la separación con Agent Core están **bien encaminados**. No hay que
rehacer el planteo. Pero hay **un error económico concreto**, **tres o cuatro
mecanismos críticos sin especificar** (cómo se *fuerza* el aislamiento multi-tenant,
el Configuration Engine, la representación del dinero, la máquina de estados del
pedido) y **una ambigüedad de modelado** (Tenant vs Merchant vs Ciudad) que, si no se
cierran ahora, sí obligan a reconstruir después. Son arreglables en Fase 0.

## Cómo leer este informe

| Doc | Contenido | Entregable del brief |
|-----|-----------|----------------------|
| [01-auditoria.md](01-auditoria.md) | Problemas encontrados + mejoras propuestas (priorizados) | A, B |
| [02-decisiones.md](02-decisiones.md) | Decisiones a tomar (con alternativas y recomendación) + preguntas + ADRs | C, L |
| [03-arquitectura.md](03-arquitectura.md) | Arquitectura recomendada, monolith vs microservicios, stack, integración Agent Core, diagramas | D, E |
| [04-modelo-de-datos.md](04-modelo-de-datos.md) | ERD, modelo Order/Delivery/Payment a prueba de evolución, modelos de config/eventos/permisos | F |
| [05-pagos-y-economia.md](05-pagos-y-economia.md) | Payment Orchestrator, ledger, refunds, conciliación; Profitability Engine (corregido) y Simulador | — |
| [06-agentes-ia.md](06-agentes-ia.md) | Estrategia de IA, Customer Shopping Agent, integración con Agent Core, modelo de scopes | I |
| [07-configuracion.md](07-configuracion.md) | Configuration Engine: herencia, precedencia, versionado, feature flags, reglas | — |
| [08-seguridad-testing.md](08-seguridad-testing.md) | Aislamiento multi-tenant, secretos, RBAC/MFA, auditoría; estrategia de testing | H |
| [09-api.md](09-api.md) | Contratos de API, versionado, idempotencia, webhooks | G |
| [10-roadmap-riesgos.md](10-roadmap-riesgos.md) | Roadmap V1–V6 y riesgos | J, K |
| **[11-cierre.md](11-cierre.md)** | **Cierre: los 10 entregables consolidados + escenarios de rentabilidad 5/7/10% (post L1–L9)** | **Todos** |

> **Actualización (2026-08-31):** respondidas L1–L9. Decisiones cerradas y los 10
> entregables previos a Fase 1 están en **[11-cierre.md](11-cierre.md)**. Empezá por ahí
> si ya leíste la auditoría.

## Prioridad usada para ordenar todo

Tal como pediste:

> **seguridad → dinero → multi-tenancy → configurabilidad → mantenibilidad → escalabilidad → UX → velocidad**

## Las 5 decisiones que necesito que cierres antes de la Fase 1

Detalle completo en [02-decisiones.md](02-decisiones.md). En orden de impacto:

1. **Aislamiento multi-tenant: ¿Postgres Row-Level Security (recomendado), schema por
   tenant, o solo a nivel aplicación?** Es la decisión #1 de seguridad y es cara de
   cambiar después. (D4)
2. **Ciudad = ¿tenant o región dentro de un tenant?** Define toda la jerarquía de
   configuración y aislamiento. Recomiendo *región dentro del tenant*; el White Label
   para terceros sí es un tenant nuevo. (D1)
3. **Integración con Agent Core: ¿SDK in-process (recomendado para V1) o servicio
   remoto?** Condiciona el stack. (D2)
4. **Estructura fiscal/societaria del flujo de dinero en V1** (¿quién es el vendedor
   de registro y quién factura?). Bloquea el diseño de Payments/Billing. Necesito tu
   input — es una pregunta, no algo que yo decida. (D5, D6)
5. **Representación del dinero: enteros en unidad mínima (centavos) + moneda, nunca
   float.** Recomiendo cerrarlo como no-negociable. (D7)
