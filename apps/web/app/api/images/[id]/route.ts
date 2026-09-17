import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Sirve una imagen guardada en la base por su UUID. Lectura pública (asset), cacheada fuerte:
// el id es opaco y el contenido no cambia, así que la marcamos immutable por un año.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return new Response("not found", { status: 404 });
  const [row] = await db().query<{ content_type: string; data: Uint8Array }>(
    `select content_type, data from images where id = $1`,
    [params.id],
  );
  if (!row) return new Response("not found", { status: 404 });
  const src = row.data as Uint8Array;
  // Copia a un ArrayBuffer propio y definido (BodyInit válido, sin el union ArrayBufferLike).
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  return new Response(ab, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "content-length": String(src.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
