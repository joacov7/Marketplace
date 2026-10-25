import type { Metadata } from "next";
import { loadShopLegal } from "@/lib/legal";
import { LegalShell, proseStyle } from "../legal-shell";
import WithdrawalForm from "./withdrawal-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Botón de arrepentimiento" };

/**
 * Botón de arrepentimiento (Ley 24.240 art. 34; Res. SCI 424/2020): revocar la compra sin
 * registrarse. Al enviar, el cliente recibe en el momento el código de su solicitud.
 */
export default async function ArrepentimientoPage({ searchParams }: { searchParams: { tenant?: string } }) {
  const shop = await loadShopLegal(searchParams.tenant);
  if (!shop) return <p style={{ padding: 24 }}>Comercio no encontrado.</p>;
  return (
    <LegalShell shop={shop} title="Botón de arrepentimiento">
      <div style={proseStyle}>
        <p style={{ marginTop: 0 }}>
          Si compraste en nuestra tienda online, tenés <b>10 días corridos</b> para arrepentirte de la compra, contados
          desde que recibiste el producto o desde la compra (lo que ocurra último), sin dar explicaciones.
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>No necesitás registrarte: completá el formulario y te damos un <b>código de solicitud</b> al instante.</li>
          <li>El producto tiene que estar en el mismo estado en que lo recibiste.</li>
          <li>Los gastos de devolución corren por cuenta del comercio. Te contactamos para coordinar el retiro y la devolución del dinero.</li>
        </ul>
      </div>
      <WithdrawalForm tenant={shop.tenant.slug} primary={shop.primary} whatsapp={shop.whatsapp} />
    </LegalShell>
  );
}
