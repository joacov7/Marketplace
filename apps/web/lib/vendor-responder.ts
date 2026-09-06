import Anthropic from "@anthropic-ai/sdk";
import type { AiTextResponder, ResponderInput } from "@commerce/modules/agent";

/**
 * Vendedor con Claude. Es un `AiTextResponder` (se inyecta en `runCustomerAgent` sin tocar
 * la orquestación): asesora como un vendedor de pet shop Y recomienda productos, pero SOLO
 * a partir de lo que encontró el catálogo real (nunca inventa productos ni precios). La
 * garantía propose-only sigue siendo estructural en el módulo: este responder solo escribe
 * texto; jamás crea pedidos ni pagos.
 *
 * Depende únicamente de `ANTHROPIC_API_KEY` (sin terceros nuevos). El modelo es configurable
 * por env `VENDOR_MODEL` (default: Haiku 4.5, barato/rápido para un chat de cliente a volumen;
 * subilo a claude-sonnet-5 o claude-opus-5 si querés más calidad). Si no hay API key, la app
 * usa el responder determinista (degrada sin romper).
 */

const MODEL = process.env.VENDOR_MODEL || "claude-haiku-4-5";

const pesos = (minor: bigint | null, currency: string | null): string =>
  minor === null ? "sin precio" : (Number(minor) / 100).toLocaleString("es-AR", { style: "currency", currency: currency || "ARS" });

function buildSystemPrompt(): string {
  return [
    "Sos el vendedor de una tienda de mascotas (pet shop) en Argentina. Atendés por chat, con",
    "calidez y trato cercano (voseo argentino). La MASCOTA es el centro: si sabés su nombre,",
    "usalo con naturalidad.",
    "",
    "Atendé como un buen vendedor de mostrador, NO como un cajero apurado. El orden es:",
    "1) ENTENDER: si el pedido es vago (p. ej. 'hola', 'necesito algo', 'comida'), hacé UNA",
    "   pregunta corta y amable para entender (qué mascota, tamaño/edad, para qué). No tires",
    "   productos todavía.",
    "2) ASESORAR: cuando tengas contexto, dá un consejo breve y con criterio.",
    "3) RECOMENDAR: sugerí 1 o 2 productos concretos que encajen, explicando en una línea por qué.",
    "",
    "Reglas firmes:",
    "- Recomendá SOLO productos de la lista 'Productos disponibles' que te paso. Nunca inventes",
    "  productos, marcas, precios ni stock. Si nada encaja, decilo con honestidad y preguntá",
    "  para afinar la búsqueda.",
    "- Nombrá los productos tal cual figuran y podés mencionar el precio si ayuda a decidir.",
    "- NO empujes a comprar. No armes ni menciones un 'carrito' salvo que te pase uno ya",
    "  preparado (te aviso explícitamente cuando lo haya). Si la persona todavía está eligiendo,",
    "  ayudala a decidir, no la apures.",
    "- SALUD: no diagnostiques ni recetes medicación. Ante síntomas o problemas de salud,",
    "  sugerí con amabilidad consultar al veterinario.",
    "- Sé breve (máximo ~90 palabras), concreto y humano. Sin listas largas ni tecnicismos.",
    "- No prometas envíos, plazos ni descuentos que no te consten.",
    "- El pago siempre lo confirma la persona; vos nunca cobrás.",
    "- Respondé en español rioplatense, en texto plano (sin markdown).",
  ].join("\n");
}

function buildUserPrompt(input: ResponderInput): string {
  const { message, hits, repurchase, cart, context } = input;
  const lines: string[] = [];

  if (context?.customerName?.trim()) lines.push(`Cliente: ${context.customerName.trim()}`);
  if (context?.petNames && context.petNames.length > 0) lines.push(`Mascotas del cliente: ${context.petNames.join(", ")}`);

  lines.push("", `Mensaje de la persona: "${message}"`, "");

  if (hits.length > 0) {
    lines.push("Productos disponibles (elegí de acá, no inventes):");
    for (const h of hits.slice(0, 8)) {
      const parts = [`- ${h.productName}${h.name && h.name !== "Único" ? ` (${h.name})` : ""}`];
      if (h.categoryName) parts.push(`categoría: ${h.categoryName}`);
      parts.push(`precio: ${pesos(h.priceMinor, h.currency)}`);
      parts.push(h.available > 0 ? `stock: ${h.available}` : "sin stock");
      if (h.description?.trim()) parts.push(`detalle: ${h.description.trim().slice(0, 160)}`);
      lines.push(parts.join(" · "));
    }
  } else {
    lines.push("Productos disponibles: (ninguno coincidió con la búsqueda)");
  }

  if (repurchase.length > 0) {
    lines.push("", `Ya compró antes: ${repurchase.slice(0, 5).map((r) => r.name).join(", ")}.`);
  }

  if (cart.items.length > 0) {
    const total = (Number(cart.totalMinor) / 100).toLocaleString("es-AR", { style: "currency", currency: cart.currency });
    lines.push("", `Le preparé un carrito sugerido (${cart.items.length} ítem/s, ${total}). Puede agregarlo con un toque; el pago lo confirma la persona.`);
  }

  lines.push("", "Respondé como el vendedor.");
  return lines.join("\n");
}

/** Devuelve un responder con Claude, o `undefined` si no hay ANTHROPIC_API_KEY. */
export function makeVendorResponder(): AiTextResponder | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;

  const client = new Anthropic({ apiKey });

  return {
    async compose(input: ResponderInput): Promise<string> {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      // Si el modelo no devolvió texto, dejamos que el llamador use el fallback.
      if (!text) throw new Error("empty_vendor_reply");
      return text;
    },
  };
}
