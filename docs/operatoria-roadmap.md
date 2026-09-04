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
1. ✅ **Pago al recibir + Aceptar/Rechazar** + **pedido manual/mostrador** + **teléfono como
   ficha de cliente** + **mascota protagonista**. **IMPLEMENTADO** (ver abajo).
2. ✅ **Pantalla de reparto (PWA)** + **cobro al entregar**: entregas del día, "Cómo llegar",
   WhatsApp, En camino / Entregado + cobro (impacta ledger/reportes). **IMPLEMENTADO**.
3. ✅ **Direcciones + seguimiento**: referencias + "compartir ubicación" GPS opcional en
   checkout; "Cómo llegar" en reparto va al pin exacto si lo hay; **seguimiento en vivo para el
   cliente** (link sin login). **IMPLEMENTADO** (ver abajo). Falta **zonas de reparto**.
4. **Mercado Pago** real: cuando el cliente tenga la cuenta, se suma "Pagar ahora".

### ✅ Eslabón 3 — implementado (ubicación + seguimiento en vivo)
- **Ubicación GPS opcional** en el checkout: botón "📍 Compartir mi ubicación" (Geolocation del
  navegador, **gratis, sin API key**). Se guardan lat/lng en el snapshot del pedido. No obliga.
- **Reparto al pin exacto**: si el pedido tiene ubicación, "Cómo llegar" abre Google Maps en las
  coordenadas; si no, en la dirección escrita. La tarjeta marca "ubicación exacta ✓".
- **Seguimiento en vivo (sin login)**: página pública `/seguimiento/<orderId>?tenant=<slug>` con
  el semáforo Recibido → En preparación → En camino → Entregado (auto-refresh cada 20 s),
  personalizada ("Pedido de Bruno"). El orderId (UUID) es la llave; expone solo el estado +
  total/ventana, nada sensible. La confirmación del checkout muestra el botón "Seguir mi pedido".
- Pieza pura testeada: `deliveryStage(estadoPedido, cumplimiento)` → etapa del cliente.
- Archivos clave: `orders.ts` (`deliveryStage`, `getOrderTracking`, lat/lng en reparto),
  rutas `api/track/[id]`, UI `app/seguimiento/[id]/*`, botón GPS + link en `storefront.tsx`,
  pin en `reparto-client.tsx`. Tests: casos Eslabón 3 en `orders.pglite.test.ts`.

### ✅ Zonas de reparto — implementado
- Reusa las tablas existentes `delivery_zones` + `delivery_rates` (+ migración 0014 que suma
  `eta_minutes` a la zona). Cada zona = nombre + **costo al cliente** + **tiempo estimado**.
- El comercio administra las zonas desde el panel (pestaña Pedidos → "📍 Zonas de reparto":
  agregar / editar costo y ETA / eliminar).
- En el checkout, si hay zonas cargadas, el cliente **elige su barrio** en un selector (con el
  costo y el tiempo a la vista); el envío toma **ese costo** (sigue gratis sobre el umbral). Sin
  zonas, se usa el envío plano de config (retrocompatible).
- El costeo por zona corre en el quote y en el checkout (matcheo por nombre, case-insensitive).
- Archivos: `delivery.ts` (`listZones`/`createZone`/`updateZone`/`deleteZone`/`zoneChargeByName`),
  migración `0014_zone_eta.sql`, rutas `api/merchant/zones{,/[id]}` + público `api/zones`,
  checkout/quote con costo por zona, selector en `storefront.tsx`, editor en `merchant/page.tsx`.
  Tests: zonas en `delivery.pglite.test.ts`.
- Follow-up menor: agrupar/ordenar la cola de reparto por zona para armar la ruta.

### ✅ Eslabón 1 — implementado (la mascota en el centro)
- **Cliente por teléfono** (`customers`, migración 0013): el teléfono normalizado es la llave;
  reutiliza la ficha sin duplicar y aísla por tenant (RLS). Usuario registrado → ficha con
  `id = user id` (las mascotas/pedidos ya existentes siguen válidos, sin migrar datos).
- **Mascota protagonista**: el checkout reconoce al cliente por teléfono, saluda ("¡Hola de
  nuevo, …!") y ofrece "¿Para quién compramos hoy? 🐾" con sus mascotas; si no la conoce,
  pide el nombre de forma natural (no obligatorio). El pedido guarda `pet_id` + `pet_name`
  (snapshot), y todo el panel/historial dice "Pedido de Bruno". Confirmación:
  "¡Listo! El pedido de Bruno está confirmado ❤️".
- **Pago al recibir**: el pedido separa `payment_method` (online/efectivo/pos/transferencia) y
  `payment_status` (pendiente/pagado). Pago al recibir entra `pendiente` y NO se cobra en el
  checkout (el cobro al entregar queda para el paso 2). Mercado Pago = "Próximamente".
- **Aceptar / Rechazar** en el panel: los pedidos de pago al recibir entran "por aceptar";
  Aceptar = confirma (consume reserva), Rechazar = cancela (libera stock). El rechazado NO se
  borra: queda en historial/reportes.
- **Pedido manual** (WhatsApp / teléfono / mostrador): mismo modelo `Order`, con `channel`.
  Aparece junto a los pedidos web, en el historial del cliente/mascota y en los reportes.
- **Datos listos para la recompra**: cliente, teléfono, mascota, fecha, productos, cantidades,
  total, canal, método y estado de pago quedan guardados (sin recordatorios automáticos aún).
- Archivos clave: `packages/modules/src/customer/*` (ficha por teléfono),
  `orders.ts` (pet/pago/canal + cola con "por aceptar"), rutas
  `api/customer/lookup`, `api/checkout`, `api/merchant/orders/{manual,[id]/decision}`,
  y UI en `storefront.tsx` + `merchant/page.tsx`. Tests: `customer.pglite.test.ts` +
  casos Eslabón 1 en `orders.pglite.test.ts`.

### ✅ Eslabón 2 — implementado (reparto + cobro al entregar)
- **Pantalla de reparto (PWA)** en `/reparto?tenant=<slug>`: mobile-first, instalable como
  ícono (web manifest en `/reparto/manifest`, sin app nativa). Acceso con un código (por ahora
  el mismo token de servicio; login por repartidor = paso siguiente). Se abre desde el panel
  (botón "🛵 Reparto").
- **Entregas del día**: seller_orders en `ready`/`in_transit`. Cada tarjeta muestra "Pedido de
  Bruno", cliente, **dirección + referencias**, ventana horaria, ítems, y **monto a cobrar**
  (mercadería + envío) con estado de pago.
- **Acciones del cadete**: "Cómo llegar" (Google Maps con la dirección escrita — GPS aún no),
  "WhatsApp" al cliente, **Salir a entregar** (→ en camino) y **Entregado** con selector de
  cobro (efectivo / POS / transferencia / "ya había pagado").
- **Cobro al entregar** (`settleCashOnDelivery`): al entregar se registra el pago 'captured' y
  se postea el **ledger/allocations igual que un pago online** → recién ahí impacta
  reportes/profitability. No reconfirma reservas (el stock se consumió al aceptar). El pedido
  pasa a **`completed`** (`completeOrder`). Idempotente (no cobra dos veces; respeta el ya
  pagado online).
- El flujo de preparación (pending→preparing→ready) sigue en el panel; recién "listo" entra a
  reparto.
- Archivos clave: `orders.ts` (`completeOrder`, `listDeliveryOrders`), `payments.ts`
  (`settleCashOnDelivery`), rutas `api/delivery/orders{,/[id]/status,/[id]/deliver}`,
  UI `app/reparto/*`. Tests: casos Eslabón 2 en `orders.pglite.test.ts` y
  `payments.pglite.test.ts`.

## Definiciones pendientes (a resolver al arrancar, no ahora)
- **Acceso del repartidor**: link con PIN/código simple (recomendado para arrancar) vs.
  usuario por repartidor.
- **Asignación**: el comercio asigna cada pedido a un repartidor, o el repartidor ve todos
  los pedidos listos (recomendado para 1–2 cadetes).

## Visión de experiencia — "ayudamos a cuidar" (flywheel)

Concepto central: **"No vendemos solo productos para mascotas. Ayudamos a sus dueños a
cuidar de ellas."** No es una tienda online tradicional, sino una experiencia centrada en la
mascota. El objetivo es una **rueda que se autoalimenta** (flywheel), armada eslabón por
eslabón (no todo a la vez):

**Compra fácil → buena entrega → recompra inteligente → referido → nuevo cliente → comunidad**

### Las 6 piezas y su estado
| Pieza | Qué es | Estado |
|---|---|---|
| 1. **Perfil de mascota** | Nombre, peso, edad, alimento, etc. Personaliza recomendaciones. | ✅ Hecho (Mis mascotas) |
| 2. **Compra rápida** | Elegís la mascota → su alimento habitual → "Repetir última compra" 1 clic + recomendaciones (snacks, higiene, antiparasitarios). | ⏳ Falta (hay calculadora/comparador; falta "repetir" y "su alimento habitual") |
| 3. **Recompra inteligente** | Estima cuándo se termina el alimento → recordatorio ("A Bruno le quedan 5 días") → "Reponer ahora". Después: **suscripción recurrente** con beneficios. | ✅ Parcial (estimación in-app lista; recordatorio proactivo = follow-up) |
| 4. **Entrega** | Confirmado → preparando → en camino → entregado ❤️ + cobro. | ✅ Operativa: reparto + cobro al entregar + **seguimiento en vivo del cliente** + ubicación GPS. Falta zonas de reparto |
| 5. **Referidos** | Amigo recibe descuento; vos recibís crédito. Niveles/embajadores. | ❌ Nuevo |
| 6. **Adopción** | Mascotas de protectoras asociadas: empatía, comunidad, identidad de marca, alianzas. | ✅ Hecho (Adopciones/callejeritos) |

### Principios de diseño del flywheel
- **El motor es identificar al cliente + el perfil de la mascota** (por teléfono/cuenta).
  Sin eso no hay personalización, recompra ni referidos → va primero.
- **Retención antes que crecimiento**: la recompra es el corazón; los referidos recién
  rinden cuando la experiencia ya fideliza.
- **Un eslabón a la vez**, midiendo que cada uno convierta antes de seguir.
- **Config por tenant**: el perfil de mascota es del vertical pet; entrega/recompra/
  referidos/suscripción son genéricos (sirven para otros verticales, p. ej. limpieza).

### Agregado a la visión: suscripción recurrente
Auto-envío del alimento cada X días con un beneficio. Es la evolución natural de la recompra
y el modelo de retención típico de las pet shops fuertes. Va **después** del recordatorio
proactivo.

### Orden del flywheel (sobre el roadmap de operatoria)
1. **Ficha de cliente por teléfono + operatoria de entrega** → base del flywheel.
2. **Compra rápida**: "elegí tu mascota → su alimento habitual → repetir en 1 clic" +
   recomendaciones.
3. **Recompra proactiva** (recordatorio por WhatsApp) → luego **suscripción**.
4. **Referidos** (amigo con descuento / crédito para vos; niveles/embajadores).
5. **Comunidad** (adopción ya está; se potencia con alianzas con protectoras).

## Follow-ups anotados de antes
- **Descuento por transferencia y recargo de auxilio**: hoy se muestran/cotizan por config,
  pero su imputación al cobro real y al ledger (allocations) queda como follow-up.
- **Pedido "completado" al entregar**: hoy queda "confirmado" (el cliente igual ve
  "Entregado"); pasar a "completado" formalmente cuando se entrega.
- **Recordatorio proactivo de reposición** (push/email): hoy el aviso es in-app; el envío
  proactivo necesita infraestructura de notificaciones.
