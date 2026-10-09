import type { Metadata } from "next";
import TrackClient from "./track-client";

export const metadata: Metadata = { title: "Seguimiento del pedido" };

/** Seguimiento público del pedido (sin login). El detalle vive en el cliente (auto-refresh). */
export default function SeguimientoPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tenant?: string; pago?: string; payment_id?: string; collection_id?: string };
}) {
  // Al volver de Mercado Pago llegan `pago` (aprobado/pendiente/error) y el id del pago.
  const mpPaymentId = searchParams.payment_id ?? searchParams.collection_id ?? "";
  return <TrackClient id={params.id} tenant={searchParams.tenant ?? ""} pago={searchParams.pago ?? ""} mpPaymentId={/^[0-9]{1,20}$/.test(mpPaymentId) ? mpPaymentId : ""} />;
}
