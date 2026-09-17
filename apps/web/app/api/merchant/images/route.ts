import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveTenant } from "@/lib/tenant";
import { requireServiceToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sube una imagen (bytes crudos en el body) y la guarda en la base. El cliente ya la
// comprime antes de mandarla, así que el límite es holgado. Devuelve la URL para servirla.
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB (post-compresión sobra)
const OK_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: Request) {
  if (!requireServiceToken("ADMIN_API_TOKEN")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await resolveTenant(new URL(req.url).searchParams.get("tenant"));
  if (!tenant) return NextResponse.json({ error: "tenant_not_resolved" }, { status: 400 });

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!OK_TYPES.has(contentType)) return NextResponse.json({ error: "unsupported_type" }, { status: 415 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const [row] = await db().query<{ id: string }>(
    `insert into images (tenant_id, content_type, data, byte_size) values ($1,$2,$3,$4) returning id`,
    [tenant.tenantId, contentType, buf, buf.length],
  );
  return NextResponse.json({ id: row!.id, url: `/api/images/${row!.id}` }, { status: 201 });
}
