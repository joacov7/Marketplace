# I — Estrategia de IA y agentes

Responde a los puntos 4 y 6 del brief. Se apoya en lo que **agent-core ya provee**
(runtime, enforcement, memoria, AI Gateway con presupuesto) para no reconstruir nada.

## Principio rector: propose-only para dinero

El agente del cliente puede **pensar y preparar**, pero **no gastar**. Toda acción que
mueve plata o crea compromisos (checkout, pago, confirmar pedido) **requiere
confirmación humana explícita**. Esto no es una recomendación blanda: se **fuerza** con
el enforcement de agent-core (no es "el prompt le pide que no lo haga").

## Cómo se mapea al enforcement real de agent-core

agent-core ya tiene exactamente las primitivas que el brief pide ("no debe poder
realizar acciones sensibles sin autorización"):

| Necesidad del brief | Primitiva de agent-core (ya existe) |
|---------------------|-------------------------------------|
| Agente no ejecuta fuera de sus scopes | Intercepción de **toda tool de escritura** por el enforcement |
| Niveles de autorización | `AutonomyMode`: `manual` (solo propone) / `assisted` (ejecuta con aprobación) / `autonomous` |
| Límites de gasto | **AI Gateway** con presupuesto por tenant y por agente (falla cerrado) |
| Entidades protegidas | `protectedEntities: EntityRef[]` en las políticas |
| Auditoría | `ResultadoAccion` + memoria persistida |
| Activación por capacidades | Manifest: se activa si la app cubre `requiereCapacidades` |

## Customer Shopping Agent (V1)

**Dueño:** Commerce OS, construido sobre el runtime de agent-core (D3 — no se toca
agent-core). **Actor:** `usuario:cliente` (scope tenant + cliente). **Autonomía tope:**
`assisted`, y las tools de dinero **no se le exponen**.

### Tools que SÍ tiene (lectura + preparación)

| Tool | Tipo | Qué hace |
|------|------|----------|
| `buscar_producto` | lectura | busca en catálogo (via `CatalogProvider`) |
| `recomendar` | lectura | recomienda por historial/mascota/presupuesto |
| `comparar` | lectura | compara productos (precio, stock, entrega) |
| `detectar_recompra` | lectura | estima recompra por cadencia (no dispara compra) |
| `armar_carrito` | escritura-suave | **prepara** un carrito propuesto (no lo compra) |
| `estimar_presupuesto` | lectura | arma una compra dentro de un tope de gasto |

### Tools que NO tiene (dinero — requieren humano)

`checkout`, `pay`, `place_order`, `apply_refund`, `change_address_on_paid_order`.
Estas son tools del dominio operadas **solo por el cliente humano** desde la UI, nunca
por el agente. Si el agente "quiere" comprar, produce un carrito preparado y la UI le
pide al humano confirmar.

### Capacidades de agent-core que consume

`catalog`, `inventory`, `contacts` (cliente + interacciones), y el módulo Pet alimenta
recomendación/recompra. El agente lee **solo** vía providers; no toca la DB del dominio.

### Memoria y privacidad

Memoria scopeada a **tenant + cliente**: preferencias, presupuesto habitual, mascotas,
marcas, cadencia de recompra. Es PII ([S4]): sujeta a minimización, borrado/export por
cliente, y nunca cruzada entre tenants (RLS + `TenantCtx`).

## Flujo del Customer Agent

```mermaid
sequenceDiagram
    participant U as Cliente (humano)
    participant UI as PWA
    participant AG as Customer Agent (Commerce OS)
    participant AC as agent-core runtime
    participant P as Providers (catálogo/inv/cliente)

    U->>UI: "necesito comida para mi perro senior, ~$X"
    UI->>AG: consulta (actor=usuario:cliente, tenant)
    AG->>AC: run (autonomía=assisted, presupuesto IA por tenant)
    AC->>P: buscar_producto / recomendar / estimar_presupuesto (solo lectura)
    P-->>AC: resultados
    AC->>AC: enforcement: tools de dinero NO expuestas
    AC-->>AG: carrito PROPUESTO + explicación
    AG-->>UI: muestra carrito propuesto
    U->>UI: revisa y confirma (acción humana)
    UI->>UI: checkout (tool de dominio, NO del agente)
    Note over AG,AC: el agente nunca ejecutó pago; solo preparó
```

## Merchant Agents (comercio)

Los agentes del comercio (soporte, ventas, stock, marketing, analítica que menciona la
sección 6) mapean directo al **catálogo existente de agent-core** (crm, precios,
inventario, cobros, rentabilidad, etc.). Actor `usuario:merchant_owner/staff`, autonomía
elegible por el comercio (`<= autonomiaMaxima` del manifest), tools de escritura
interceptadas. **No hay que construirlos**: se activan cuando Commerce OS expone las
capacidades correspondientes como providers.

## Developer/DevOps Agents

**Pertenecen a Agent Core, no a Commerce OS** (coincide con el brief). No se modelan
acá.

## Model routing / vendor lock-in de IA

agent-core abstrae el proveedor de IA (`AiCompletionProvider`) y ya cobra presupuesto y
atribuye gasto agnóstico del proveedor. Eso **ya resuelve** el riesgo "Vendor lock-in
IA" de la sección 18. Commerce OS no elige modelo; inyecta el provider de IA a
agent-core.

## Estrategia de IA — resumen de decisiones

- **Reutilizar agent-core al máximo**; el Customer Agent es lo único nuevo, y se compone
  de primitivas existentes.
- **Propose-only para dinero**, forzado por enforcement, no por prompt.
- **Costo de IA controlado y atribuido** por tenant/agente (presupuesto de agent-core →
  Profitability Engine).
- **Invocación on-demand + recomendaciones cacheadas** ([U1]): no llamar al modelo en
  cada pageview.
- **Memoria como PII de primera clase** (scope tenant+cliente, borrable).
