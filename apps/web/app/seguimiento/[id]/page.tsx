import type { Metadata } from "next";
import TrackClient from "./track-client";

export const metadata: Metadata = { title: "Seguimiento del pedido" };

/** Seguimiento público del pedido (sin login). El detalle vive en el cliente (auto-refresh). */
export default function SeguimientoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tenant?: string };
}) {
  return <TrackClient id={params.id} tenant={searchParams.tenant ?? ""} />;
}
