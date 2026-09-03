# Operatoria — compra hasta entrega (roadmap acordado)

> Notas de diseño acordadas con el cliente (Pet Shop Gualeguay). **Todavía sin programar.**
> Objetivo: operatoria sencilla, amigable, didáctica y eficiente, con buena experiencia
> desde la compra hasta la entrega. Todo lo de abajo es config/feature nuestro salvo donde
> se aclara que necesita una cuenta externa.

## Decisiones tomadas
- **Pago: online + al recibir.** Se ofrecen ambos:
  - *Pagar ahora* → Mercado Pago (**necesita la cuenta del cliente**; hasta conectarla, el
    botón queda "Próximamente").
  - *Pagar al recibir* → Efectivo / Tarjeta con POS / Transferencia.
- **Pantalla del repartidor: sí**, como web/PWA (no app nativa). Se "instala" como ícono en
  el celular; alcanza y sobra para uno o pocos cadetes. App nativa con GPS en vivo solo si
  se escala a varios repartidores (más caro de mantener) — no ahora.
- **Identificación del cliente por teléfono** (no obligar registro). El teléfono es la ficha
  del cliente y la llave para estadística por cliente + recompra + reposición.
- **Direcciones: dirección escrita obligatoria + referencias + ubicación opcional.**

## La operatoria de punta a punta
### Cliente (checkout)
1. Arma carrito (sin obligar a registrarse — guest checkout).
2. Completa: **dirección escrita (obligatoria)** + **referencias** (timbre, color de casa,
   entre calles) + **teléfono/WhatsApp (obligatorio)** + **"📍 Compartir mi ubicación" (opcional)**.
3. Elige **ventana de entrega** y **cómo paga** (online / al recibir).
4. Confirma → recibe **link de seguimiento** (sin login) + aviso por WhatsApp.

### Comercio (panel → Pedidos)
- Pedido **pagado online** → entra **confirmado**; solo prepara y despacha.
- Pedido **a pagar al recibir** → entra en estado **"A aceptar"** (stock ya reservado). El
  comercio **Acepta** (o Rechaza) → Prepara → Listo → despacha.
- El **cobro** de "pago al recibir" se **registra al entregar** (no en el checkout); recién
  ahí impacta en ledger/reportes.

### Repartidor (pantalla móvil / PWA)
- **Entregas del día**: dirección + referencias, **botón "Cómo llegar"** (abre Google Maps
  con el pin si hay ubicación, o con la dirección escrita), **WhatsApp al cliente**.
- **Monto a cobrar** y forma de pago.
- Botones: **En camino → Entregado** + **registrar cobro** (efectivo / POS / transferencia /
  "ya pagó online").

### Cliente (seguimiento)
- Ve el estado en vivo en su link: En preparación → En camino → Entregado.

## Estados del pedido (semáforo)
| Situación | Estado interno | Qué ve el cliente |
|---|---|---|
| Pago al recibir, recién creado | **A aceptar** | Pedido recibido |
| Comercio acepta (o pago online OK) | confirmado | En preparación |
| Sale a repartir | en camino | En camino |
| Entregado (+ cobro registrado) | **completado** | Entregado ✅ |
| Rechazado / cancelado | cancelado | Cancelado |

## Estadística y recompra (aclaración importante)
- **Estadística/reportes**: funciona con **todo pedido que entre al sistema** (web guest o
  WhatsApp/teléfono cargado a mano). NO requiere que el cliente tenga cuenta.
- **Recompra / reposición / fidelización a una persona**: requiere **identificar al cliente**
  → por cuenta **o por teléfono**. Con el teléfono en cada compra alcanza para armar la lista
  de clientes y ofrecer recompra por WhatsApp sin exigir registro.
- Lo único que NO cuenta es el WhatsApp que queda **solo en el chat** → por eso el
  **pedido manual/mostrador** es clave: convierte ese chat en un pedido real que suma.

## Direcciones y ubicación
- **Dirección escrita = obligatoria** (calle + número + barrio). En Gualeguay con eso el
  cadete llega casi siempre.
- **Referencias = destacadas** (muy valiosas en Argentina).
- **"Compartir mi ubicación" = opcional** (GPS del navegador, Geolocation): **gratis, sin
  API key**. Se guardan coordenadas y el cadete navega exacto.
- Un **mapa embebido** para arrastrar el pin necesitaría cuenta de Google Cloud con
  facturación → **no hace falta para arrancar**.
- La dirección trae el **barrio** → habilita **zonas de reparto** (costo/tiempo por zona) y
  organizar la ruta por barrio. (Engancha con el precio de envío ya existente.)

## Qué es nuestro vs. qué necesita cuenta externa
- **Nuestro (config/feature, sin terceros)**: pago al recibir, aceptar/rechazar, cobro al
  entregar, pantalla de reparto, ficha de cliente por teléfono, recompra por WhatsApp,
  dirección + ubicación opcional, zonas de reparto, pedido manual/mostrador.
- **Necesita cuenta del cliente**: **Mercado Pago** (para "Pagar ahora" online).

## Orden de construcción propuesto (cuando dé el OK)
1. **Pago al recibir + Aceptar/Rechazar + cobro al entregar** (ya se opera de verdad, sin
   depender de nadie) + **pedido manual/mostrador** (para no perder WhatsApp/teléfono) +
   **teléfono como ficha de cliente**.
2. **Pantalla de reparto (PWA)**: entregas del día, "Cómo llegar", WhatsApp, Entregado/Cobrado.
3. **Direcciones**: referencias + "compartir ubicación" opcional en checkout; botón "Cómo
   llegar" en reparto; (más adelante) zonas de reparto.
4. **Mercado Pago** real: cuando el cliente tenga la cuenta, se suma "Pagar ahora".

## Definiciones pendientes (a resolver al arrancar, no ahora)
- **Acceso del repartidor**: link con PIN/código simple (recomendado para arrancar) vs.
  usuario por repartidor.
- **Asignación**: el comercio asigna cada pedido a un repartidor, o el repartidor ve todos
  los pedidos listos (recomendado para 1–2 cadetes).

## Follow-ups anotados de antes
- **Descuento por transferencia y recargo de auxilio**: hoy se muestran/cotizan por config,
  pero su imputación al cobro real y al ledger (allocations) queda como follow-up.
- **Pedido "completado" al entregar**: hoy queda "confirmado" (el cliente igual ve
  "Entregado"); pasar a "completado" formalmente cuando se entrega.
- **Recordatorio proactivo de reposición** (push/email): hoy el aviso es in-app; el envío
  proactivo necesita infraestructura de notificaciones.
