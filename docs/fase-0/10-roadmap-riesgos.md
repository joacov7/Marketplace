# J + K — Roadmap y riesgos

## J — Roadmap

Mantiene las versiones del documento (sección 14) y agrega, por cada una, **qué hay que
dejar preparado desde V1 para no reconstruir**. El principio: construir el núcleo para
el futuro, operar el MVP con la mínima complejidad.

| Ver | Alcance operativo | Qué se construye | Qué se deja preparado (sin activar) |
|-----|-------------------|------------------|--------------------------------------|
| **V1** | Pet shops propios; 1 pedido = 1 comercio = 1 entrega | Core agnóstico + módulo Pet, Config Engine, multi-tenant (RLS), Payments (MP, cuenta propia), Delivery directo, Customer Agent básico, Simulador, Profitability | Esqueleto multi-seller (SellerOrder/Allocation/Route), ledger, `InvoiceIssuer`, secret store por-merchant, contratos de evento |
| **V2** | Comercios externos; marketplace; comisiones y liquidaciones | Onboarding merchant (KYC + MP connect), payouts, facturación marketplace, split real | Broker de eventos si el volumen lo pide |
| **V3** | Customer Agent avanzado; comparación entre comercios; recompra inteligente | Ampliar tools del agente (comparación cross-merchant en lectura), recompra por cadencia | — |
| **V4** | Multi-comercio opcional; consolidación y rutas | Subir `maxSellersPerOrder`, módulo de consolidación, `Route` con multi-pickup, motor de ruteo (VRP) | Ya soportado por el modelo de datos |
| **V5** | White Label para terceros; multi-ciudad | Tenant nuevo por operador (D1); provisioning self-service | Ya soportado por tenancy + Config Engine |
| **V6** | Multi-vertical (super, ferretería, retail) | Nuevos **módulos de vertical** (D10) | Core agnóstico ya lo permite |

### Fases de implementación sugeridas para V1 (cada una termina con tests + docs)

1. **Fundaciones**: monorepo TS, módulos con linter de fronteras, Postgres + RLS +
   contexto de tenant, Config Engine, Identity/RBAC, outbox. *(Sin esto, todo lo demás
   se construye mal.)*
2. **Catálogo + Inventario + Carrito** (con reserva de stock).
3. **Orders + máquina de estados + Payments (MP) + ledger + idempotencia**.
4. **Delivery directo + Profitability + Simulador**.
5. **Integración Agent Core + Customer Agent (propose-only)**.
6. **White Label provisioning + backoffice + observabilidad**.
7. **Endurecimiento**: suite de aislamiento/pagos completa, conciliación, restore
   probado.

> El orden respeta la prioridad: seguridad/multi-tenancy y dinero primero; agente y
> white-label después, sobre cimientos firmes.

## K — Riesgos

Amplía la tabla de la sección 18 con los riesgos que la revisión agregó y su mitigación.

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| **Fuga cross-tenant** (el más grave) | Alta | RLS + contexto obligatorio + tests de aislamiento por entidad ([S1]) |
| **Doble cobro / doble pedido** | Alta | Idempotencia en checkout y webhooks; ledger ([D2$]) |
| **Fórmula económica incorrecta** (ya detectada) | Alta | Dos P&L separados; GMV no es sumando ([D-ERR]) |
| **Dinero con float / moneda ambigua** | Alta | Enteros centavos + moneda; doble partida (D7) |
| **Oversell de stock** | Alta | Reserva atómica con TTL ([G1]) |
| **Secretos de PSP mal guardados** | Alta | Secret store por-merchant cifrado ([S3]) |
| **Agente ejecuta acción de dinero** | Alta | Propose-only forzado por enforcement ([S2]) |
| **Big ball of mud** (monolith sin fronteras) | Media | Linter de fronteras + tablas por módulo + eventos ([A1]) |
| **Sobre-ingeniería** (Kafka/k8s/microservicios en V1) | Media | Modular monolith + outbox; broker solo cuando el volumen lo pida ([A2]) |
| **Sobre-configurabilidad** (DSL genérico) | Media | Config tipada + primitivas acotadas, sin DSL ([C2]) |
| **Fiscalidad AR incorrecta** | Media | Abstracción `InvoiceIssuer` + validación profesional; no hardcodear ([D3$]) |
| **Logística poco rentable** | Media | Directo por comercio en V1; costo por pedido; Profitability alerta |
| **Comisión percibida cara** | Media | Simulador honesto basado en valor incremental |
| **Vendor lock-in PSP / IA** | Media | Payment Orchestrator + AI provider abstraído (agent-core ya lo hace) |
| **"Vertical sin código" sobre-prometido** | Baja | Honestidad: core agnóstico + módulos de vertical ([A3]) |
| **Latencia/costo del agente en cada render** | Baja | On-demand + recomendaciones cacheadas ([U1]) |
| **PII de mascotas/salud sin protección** | Media | Minimización + borrado/export + no loguear ([S4]) |

## Documentos vivos a mantener (sección 16 del doc)

Esta revisión ya deja el esqueleto; en Fase 1 se pueblan:

- `docs/ARCHITECTURE.md` ← consolidar [03] y [04]
- `docs/DECISIONS.md` ← ADRs de [02]
- `docs/CONFIGURATION.md` ← catálogo de claves de [07]
- `docs/API.md` ← contratos de [09]
- `docs/ROADMAP.md` ← este documento

## Cierre de la Fase 0

El planteo del v3 es bueno y **no hay que reconstruirlo**. Con las correcciones de este
informe —el error de la fórmula, el mecanismo de aislamiento, el Config Engine, la
representación del dinero, las invariantes de Order/Delivery/Payment y la jerarquía de
tenancy— el sistema cumple la regla principal: **construir el núcleo para el futuro,
operar el MVP con la mínima complejidad**.

**Próximo paso:** revisar las decisiones de [02-decisiones.md](02-decisiones.md) y
responder las preguntas L1–L9. Con eso cerrado, arranca la Fase 1.
