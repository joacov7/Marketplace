import type { Db } from "@commerce/platform";

/**
 * Idempotencia del checkout (tabla checkout_requests). Todas corren dentro de `withTenant`.
 *
 * Flujo: `claimCheckout` antes de crear nada →
 *  - "new": esta request es la dueña de la clave; al terminar, `completeCheckout` (éxito) o
 *    `releaseCheckout` (error: la clave queda libre para reintentar).
 *  - "replay": ya se resolvió con esta clave → devolver la respuesta guardada, sin crear otro.
 *  - "in_progress": otra request con la misma clave está creando el pedido ahora.
 *  - "mismatch": la clave ya se usó con OTRO contenido (carrito/datos distintos).
 */
export type CheckoutClaim =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "in_progress" }
  | { kind: "mismatch" };

/** Un reclamo sin pedido ni respuesta más viejo que esto se considera abandonado (la función murió). */
const STALE_CLAIM = "2 minutes";
const RETENTION = "7 days";

export async function claimCheckout(
  db: Db,
  input: { tenantId: string; key: string; requestHash: string },
): Promise<CheckoutClaim> {
  // Limpieza oportunista de este tenant (usa el índice por tenant + fecha).
  await db.query(`delete from checkout_requests where created_at < now() - interval '${RETENTION}'`);

  const claimed = await db.query<{ idempotency_key: string }>(
    `insert into checkout_requests (tenant_id, idempotency_key, request_hash) values ($1, $2, $3)
     on conflict (tenant_id, idempotency_key) do update set created_at = now()
       where checkout_requests.response is null
         and checkout_requests.order_id is null
         and checkout_requests.request_hash = excluded.request_hash
         and checkout_requests.created_at < now() - interval '${STALE_CLAIM}'
     returning idempotency_key`,
    [input.tenantId, input.key, input.requestHash],
  );
  if (claimed.length > 0) return { kind: "new" };

  const [row] = await db.query<{ request_hash: string; response_status: number | null; response: unknown }>(
    `select request_hash, response_status, response from checkout_requests where idempotency_key = $1`,
    [input.key],
  );
  if (!row) return { kind: "in_progress" }; // se liberó entre el insert y el select: que reintente
  if (row.request_hash !== input.requestHash) return { kind: "mismatch" };
  if (row.response != null && row.response_status != null) {
    const body = typeof row.response === "string" ? JSON.parse(row.response) : row.response;
    return { kind: "replay", status: row.response_status, body };
  }
  return { kind: "in_progress" };
}

/** Graba el pedido apenas se crea (si la función muere después, la clave no se reutiliza). */
export async function recordCheckoutOrder(db: Db, key: string, orderId: string): Promise<void> {
  await db.query(`update checkout_requests set order_id = $2 where idempotency_key = $1`, [key, orderId]);
}

/** Guarda la respuesta exitosa para devolverla tal cual a los reintentos. */
export async function completeCheckout(db: Db, key: string, status: number, body: unknown): Promise<void> {
  await db.query(
    `update checkout_requests set response_status = $2, response = $3::text::jsonb where idempotency_key = $1`,
    [key, status, JSON.stringify(body)],
  );
}

/** El intento falló sin dejar pedido: libera la clave para que el cliente pueda reintentar. */
export async function releaseCheckout(db: Db, key: string): Promise<void> {
  await db.query(`delete from checkout_requests where idempotency_key = $1 and response is null`, [key]);
}
