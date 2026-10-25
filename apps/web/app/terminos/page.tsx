import type { Metadata } from "next";
import { loadShopLegal } from "@/lib/legal";
import { LegalShell, proseStyle } from "../legal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Términos y condiciones" };

const DEFENSA_CONSUMIDOR = "https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario";

/**
 * Términos y condiciones + política de privacidad. Modelo base con los datos del comercio
 * (Configuración → Datos legales). Debe revisarlo un abogado antes de darlo por definitivo.
 */
export default async function TerminosPage({ searchParams }: { searchParams: { tenant?: string } }) {
  const shop = await loadShopLegal(searchParams.tenant);
  if (!shop) return <p style={{ padding: 24 }}>Comercio no encontrado.</p>;
  const q = `?tenant=${encodeURIComponent(shop.tenant.slug)}`;
  const h2: React.CSSProperties = { fontSize: 18, margin: "26px 0 8px" };
  const contacto = [shop.email && `el email ${shop.email}`, shop.whatsapp && `WhatsApp ${shop.whatsapp}`].filter(Boolean).join(" o ");
  return (
    <LegalShell shop={shop} title="Términos y condiciones">
      <div style={proseStyle}>
        <h2 style={{ ...h2, marginTop: 0 }}>1. Quién vende</h2>
        <p>
          Esta tienda online es operada por <b>{shop.businessName}</b>
          {shop.taxId && <> (CUIT {shop.taxId})</>}
          {shop.address && <>, con domicilio en {shop.address}</>}. Al comprar aceptás estos términos.
        </p>

        <h2 style={h2}>2. Productos y precios</h2>
        <p>Los precios están expresados en pesos argentinos y pueden cambiar sin aviso, pero se respeta el precio vigente al momento de confirmar tu pedido. Antes de confirmar te mostramos el detalle del pedido, el costo de envío y el total a pagar. Las imágenes son ilustrativas.</p>

        <h2 style={h2}>3. Pedidos y pagos</h2>
        <p>Si elegís pagar al recibir (efectivo, transferencia o tarjeta con POS), el comercio confirma el pedido según disponibilidad y te avisa. Si pagás con Mercado Pago, el pedido se confirma cuando Mercado Pago aprueba el pago. Los datos de tu tarjeta los procesa Mercado Pago; la tienda no los ve ni los guarda.</p>

        <h2 style={h2}>4. Envíos</h2>
        <p>Entregamos dentro de la zona de reparto informada en la tienda, en los días y franjas horarias indicadas. El costo de envío se informa antes de confirmar. Podés seguir el estado de tu pedido con el link de seguimiento.</p>

        <h2 style={h2}>5. Derecho de arrepentimiento</h2>
        <p>Tenés 10 días corridos desde la entrega o la compra (lo último) para revocar la compra sin dar explicaciones, mediante el <a href={`/arrepentimiento${q}`} style={{ color: shop.primary, fontWeight: 600 }}>Botón de arrepentimiento</a>. El producto debe estar en el mismo estado en que lo recibiste y los gastos de devolución corren por cuenta del comercio.</p>

        <h2 style={h2}>6. Garantía y cambios</h2>
        <p>Si un producto llega dañado, vencido o con defectos, avisanos y lo cambiamos o te devolvemos el dinero, según la garantía legal de la Ley 24.240 de Defensa del Consumidor.</p>

        <h2 style={h2}>7. Club de puntos y suscripciones</h2>
        <p>Si el comercio tiene activo el club de puntos, los puntos se suman con los pedidos entregados y se canjean por los premios vigentes. No tienen valor en dinero ni son transferibles, y el comercio puede cambiar los premios. Las suscripciones de envío periódico se pueden pausar o cancelar cuando quieras.</p>

        <h2 style={h2}>8. Privacidad y datos personales</h2>
        <p>Usamos tus datos (nombre, teléfono, email, dirección de entrega, mascotas y pedidos) solo para preparar y entregar tus compras, recordarte reposiciones y atenderte. No los vendemos ni los cedemos a terceros, salvo a los servicios necesarios para operar la tienda (por ejemplo, Mercado Pago para cobrar). Podés pedir acceso, corrección o eliminación de tus datos{contacto ? <> escribiendo a {contacto}</> : null}.</p>
        <p style={{ fontSize: 13, color: "#666" }}>El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto, conforme lo establecido en el artículo 14, inciso 3 de la Ley N° 25.326. La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.</p>

        <h2 style={h2}>9. Consultas y reclamos</h2>
        <p>
          Para cualquier consulta o reclamo{contacto ? <> escribinos a {contacto}</> : <> escribinos por los medios de contacto de la tienda</>}.
          {" "}Defensa de las y los Consumidores. Para reclamos{" "}
          <a href={DEFENSA_CONSUMIDOR} target="_blank" rel="noopener noreferrer" style={{ color: shop.primary, fontWeight: 600 }}>ingresá aquí</a>.
        </p>
      </div>
    </LegalShell>
  );
}
