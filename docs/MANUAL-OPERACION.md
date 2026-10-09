# Manual de operación

Guía para operar y mantener la tienda **sin ser programador**. Está escrita para vos,
que atendés el negocio. No hace falta entender el código: cada situación tiene sus pasos.

Si algo no está acá o no te sale, al final está **"Cuando algo se rompe"** (qué mirar y a
quién avisar).

---

## Cómo está armada la tienda (en 30 segundos)

- **La tienda** (lo que ven los clientes) y **el panel** (donde vos cargás productos, ves
  pedidos, etc.) son la misma aplicación, alojada en **Vercel**.
- **Los datos** (productos, pedidos, clientes, fotos) viven en una base de datos en **Neon**.
  Las fotos que subís también se guardan ahí, no en un servicio aparte.
- **El código** vive en **GitHub**. Cuando se hace un cambio en el código, Vercel publica la
  versión nueva sola, en 1–2 minutos.

No tenés que instalar nada en tu computadora para operar el día a día: todo se hace desde
el navegador.

---

## El día a día

### Entrar al panel

1. Andá a `https://TU-TIENDA.vercel.app/merchant` (reemplazá por tu dirección real).
2. Ingresá con tu **email y contraseña**.
3. Listo. Desde ahí manejás productos, categorías, pedidos, zonas de reparto, diseño de la
   tienda, reportes y el estudio de contenido.

> La sesión queda guardada un tiempo. Si te pide entrar de nuevo, volvé a poner email y
> contraseña. Para salir, usá **"Cerrar sesión"** (arriba en el panel).

### Crear tu acceso la primera vez

Si todavía no tenés usuario:

1. Entrá a `/merchant` y tocá **"Primera vez: crear mi acceso"**.
2. Poné tu **email**, la **contraseña** que quieras (mínimo 8 caracteres) y el **token de
   administrador** (`ADMIN_API_TOKEN` — está guardado en Vercel; lo tenés vos o quien montó
   la tienda).
3. Tocá **"Crear y entrar"**. Queda creado tu usuario dueño y entrás directo.

A partir de ahí ya entrás siempre con email y contraseña; el token no se usa más en el día
a día.

> **Sumar más usuarios** (empleados con acceso al panel): hoy se crean con el mismo método
> ("Primera vez") usando el token. Cada uno con su email y contraseña.

---

## Publicar un cambio (deploy)

No tenés que hacer nada especial: **cuando se aprueba un cambio en el código, Vercel publica
solo.** Vas a ver el sitio actualizado en 1–2 minutos.

Para confirmar que un deploy salió bien:

1. Entrá a tu proyecto en [vercel.com](https://vercel.com) → pestaña **Deployments**.
2. El último de arriba tiene que decir **Ready** (verde). Si dice **Error** (rojo), el cambio
   no salió y el sitio sigue mostrando la versión anterior (no se rompe nada).

---

## La base de datos y las migraciones

Cuando el sistema necesita una tabla o columna nueva, eso se llama **migración**. **Se
aplican solas en cada deploy** — no tenés que correr nada a mano.

Cómo saber que se aplicaron: en Vercel → Deployments → abrí el último → **Building /
Logs** y buscá líneas que empiezan con `[migrate]`. Vas a ver:

- `[migrate] Base al día — nada que aplicar.` → todo en orden, no había nada nuevo.
- `[migrate] Aplicando N migración(es) nueva(s)…` + `✓ ...` → aplicó cambios nuevos, bien.
- `[migrate] ERROR ...` → algo falló; **el deploy no se publica** (mejor eso que dejar la
  base a medias). Mirá **"Cuando algo se rompe"**.

> **Botón de respaldo:** en el panel hay un botón para correr las migraciones a mano
> (`/api/admin/migrate`). Normalmente no hace falta, porque ya corren en el deploy.

---

## Copias de seguridad (backups)

Los backups los hace **Neon** automáticamente, pero conviene revisarlo:

1. Entrá a [neon.tech](https://neon.tech) → tu proyecto.
2. Verificá que esté activo **Point-in-time restore** (poder volver la base a como estaba en
   un momento del pasado). En planes pagos suele guardar varios días de historial.
3. Si alguna vez necesitás **restaurar**, se hace desde ahí (Restore / Branch). Ante la duda,
   **no toques nada** y pedí ayuda: restaurar mal puede pisar datos buenos.

> Recomendación: tener el plan de Neon que incluya al menos **7 días** de historial de
> restauración. Es la red de seguridad ante un borrado accidental.

---

## Las "llaves" (variables de entorno)

Son secretos que la app necesita para funcionar. Se configuran en **Vercel → Settings →
Environment Variables**. No las compartas ni las subas a ningún lado.

| Llave | Para qué sirve | Si falta / está mal |
|-------|----------------|---------------------|
| `DATABASE_URL` | Conexión a la base de datos (Neon). | La tienda no carga datos: no hay productos ni pedidos. |
| `ADMIN_API_TOKEN` | Contraseña maestra para crear tu usuario y tareas de administración. | No podés crear el primer usuario. |
| `SESSION_SECRET` | Firma las sesiones (mantiene abierto tu login). | Si no está, usa el `ADMIN_API_TOKEN` como respaldo. **Conviene ponerla aparte** (ver rotación). |
| `CRON_SECRET` | Protege las tareas automáticas diarias. | Las tareas automáticas dejan de correr o quedan expuestas. |
| `ANTHROPIC_API_KEY` | Motor del **Vendedor IA** (el chat que asesora en la tienda). | El chat responde de forma básica, sin IA. El resto de la tienda funciona igual. |
| `VENDOR_MODEL` | *(Opcional)* Elige el modelo de IA del Vendedor IA. | Usa uno por defecto. |
| `PAYMENTS_ENCRYPTION_KEY` | Cifra el Access Token de Mercado Pago guardado en la base. Una frase larga (32+ caracteres). | No se puede conectar Mercado Pago y "Pagar ahora" no aparece. **No la cambies** una vez conectado MP (ver abajo). |

### Rotar (cambiar) una llave

Se cambia una llave cuando se pudo haber filtrado, o por seguridad periódica.

1. Generá un secreto fuerte y largo (podés usar un generador de contraseñas).
2. Vercel → Settings → Environment Variables → editá el valor → **Save**.
3. **Redeploy**: Deployments → último → **Redeploy** (para que tome el valor nuevo).

> **Ojo con `PAYMENTS_ENCRYPTION_KEY`:** con ella se cifró el Access Token de Mercado Pago.
> Si la cambiás, la app ya no puede leer el token guardado y "Pagar ahora" falla. Si
> necesitás cambiarla: cambiala, hacé Redeploy y **volvé a conectar Mercado Pago** desde el
> panel (pegando el Access Token de nuevo).

> **Ojo con `ADMIN_API_TOKEN` y `SESSION_SECRET`:** si `SESSION_SECRET` **no** está definida,
> las sesiones se firman con `ADMIN_API_TOKEN`. En ese caso, cambiar `ADMIN_API_TOKEN`
> **cierra la sesión de todos** (tienen que volver a entrar). Para evitarlo, definí una
> `SESSION_SECRET` propia (distinta del token): así podés rotar el token sin echar a nadie.

---

## Cobrar online con Mercado Pago ("Pagar ahora")

Con Mercado Pago conectado, la tienda ofrece **Pagar ahora**: el cliente paga en la página
de Mercado Pago (tarjeta, débito o dinero en cuenta) y vuelve al seguimiento de su pedido.
El pedido entra al panel **ya confirmado y pagado**; no hay que aceptarlo. Pagar al recibir
sigue funcionando igual. La plata la cobra **tu cuenta de Mercado Pago** directamente.

### Conectarlo (una sola vez, ~10 min)

1. **Llave de cifrado** (si no está): en Vercel → Settings → Environment Variables, agregá
   `PAYMENTS_ENCRYPTION_KEY` con una frase larga inventada (32+ caracteres) → Save →
   **Redeploy**. Guardala en un lugar seguro.
2. **Credenciales de Mercado Pago:** entrá a
   [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers) con la cuenta
   del negocio → **Tus integraciones** → **Crear aplicación** (tipo "Pagos online", producto
   "Checkout Pro"). Adentro: **Credenciales de producción** → copiá el **Access Token**
   (empieza con `APP_USR-`).
3. **Pegarlo en el panel:** Configuración → **Cobros online — Mercado Pago** → pegá el Access
   Token → **Conectar**. La app lo valida con Mercado Pago y lo guarda cifrado. Si sale bien,
   ves el nombre de tu cuenta y la etiqueta **Activo**: "Pagar ahora" ya aparece en la tienda.
4. **Recomendado — avisos firmados:** en el panel abrí "Configurar los avisos (webhooks)",
   copiá la URL. En Mercado Pago → tu aplicación → **Webhooks** → pegá la URL, marcá el
   evento **Pagos** y guardá. Mercado Pago te muestra una **clave secreta**: pegala en el
   panel → **Guardar clave**. (Funciona sin esto, pero así la tienda rechaza avisos falsos.)

> **Para probar sin plata real:** usá el Access Token **de prueba** (empieza con `TEST-`) y
> pagá con las tarjetas de prueba de Mercado Pago. El panel muestra "Activo (modo prueba)".
> Cuando termines, cambiá al token de producción con **Cambiar credenciales**.

### El día a día
- **Pausar "Pagar ahora"** (p. ej. un problema con tu cuenta de MP): botón **Pausar** en el
  mismo panel. No borra nada; se reactiva con un clic.
- **El cliente tiene 30 minutos para pagar.** Si no paga, el stock se libera solo y el
  pedido no aparece en tu cola. A los 3 días se cancela automáticamente.
- **Reembolsos:** se hacen desde tu cuenta de Mercado Pago (Actividad → el pago → Devolver
  dinero).
- **"Pagos para reembolsar"** (recuadro rojo en el panel): son pagos que Mercado Pago aprobó
  *después* de que el pedido se canceló por falta de pago (raro). Devolvé ese dinero desde
  Mercado Pago o contactá al cliente para entregarle igual.

---

## Tareas automáticas (crons)

Todos los días a las **6:00** corre una tarea que: procesa reservas de stock vencidas,
suscripciones, avisos pendientes y cancela los pedidos "Pagar ahora" que nunca se pagaron.
La dispara Vercel sola.

- Verla: Vercel → tu proyecto → **Cron Jobs**. Ahí figura la última ejecución.
- Si una falla, no pasa nada grave de inmediato; se reintenta al día siguiente. Si falla
  varios días seguidos, revisá que `CRON_SECRET` esté bien y mirá los logs.

---

## Cuando algo se rompe

Buscá el síntoma y seguí los pasos. **Regla de oro:** ante la duda, no borres ni restaures
nada; sacá una captura del error y pedí ayuda.

### La tienda no abre / da error a los clientes
1. Vercel → Deployments: ¿el último está **Ready** (verde)? Si está en **Error** (rojo), el
   problema entró con el último cambio. Solución rápida: abrí un deploy anterior que estaba
   en verde y usá **"Promote to Production"** (volver a esa versión). El sitio se arregla en
   el momento.
2. Si el último está verde pero igual falla: revisá **Neon** (siguiente punto).

### Dice que no hay productos, o no guarda nada
- Casi siempre es la base de datos. Entrá a [neon.tech](https://neon.tech) → ¿el proyecto
  está **activo**? (en algunos planes se "suspende" por inactividad y tarda unos segundos en
  despertar).
- Verificá en Vercel que `DATABASE_URL` esté cargada y sea la de Neon (con `-pooler` y
  `sslmode=require`).

### No puedo entrar al panel
- ¿Email y contraseña correctos? Probá de nuevo.
- Si a todos les pide entrar de repente, quizás se rotó `ADMIN_API_TOKEN` sin tener
  `SESSION_SECRET` (ver la nota en "Rotar una llave"). Volvé a entrar con email y contraseña;
  si no tenés usuario, usá **"Primera vez"** con el token.

### Un deploy quedó en Error y en los logs veo `[migrate] ERROR`
- Una migración falló, así que **ese cambio no salió** (el sitio sigue con la versión
  anterior, sana). No toques la base. Sacá captura del mensaje de error completo y pedí ayuda
  a quien mantiene el código: es un problema del cambio nuevo, no de tu operación.

### El Vendedor IA responde de forma básica
- Revisá `ANTHROPIC_API_KEY` en Vercel (que esté cargada y vigente). El resto de la tienda
  funciona igual sin esto.

### "Pagar ahora" no aparece en la tienda
- Panel → Configuración → Cobros online: ¿dice **Activo**? Si dice Pausado, activalo. Si
  pide la llave `PAYMENTS_ENCRYPTION_KEY`, cargala en Vercel y hacé Redeploy.

### Un cliente pagó con Mercado Pago pero el pedido no aparece
- Pedile el número de operación de Mercado Pago y buscalo en tu cuenta de MP: ¿figura
  **Aprobado**? Normalmente el pedido aparece en segundos. Si no:
  1. Revisá que el Access Token siga vigente (panel → Cobros online → Cambiar credenciales y
     volvé a pegarlo).
  2. Si cargaste la clave secreta de webhooks, verificá que sea la de esa misma aplicación.
  3. En Vercel → Logs, buscá líneas `[webhook:mercadopago]` y sacá captura para pedir ayuda.

---

## Dónde mirar y a quién avisar

- **Estado del sitio y deploys:** Vercel → tu proyecto → Deployments.
- **Errores de la app:** Vercel → Deployments → abrí uno → Logs (y Runtime Logs).
- **Base de datos y backups:** Neon → tu proyecto.
- **El código y los cambios:** GitHub → el repositorio.

Cuando pidas ayuda técnica, mandá siempre: **(1)** qué estabas haciendo, **(2)** captura del
error, **(3)** el link del deploy en Vercel. Con eso se resuelve mucho más rápido.
