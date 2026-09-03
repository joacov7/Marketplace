import { NextResponse } from "next/server";

export const dynamic = "force-static";

// Ícono maskable simple (huella) embebido como data URI: sin assets binarios ni red externa.
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#2E7D32"/><g fill="#fff"><circle cx="188" cy="196" r="34"/><circle cx="256" cy="164" r="36"/><circle cx="324" cy="196" r="34"/><circle cx="150" cy="284" r="30"/><circle cx="362" cy="284" r="30"/><path d="M256 260c-52 0-96 40-96 84 0 30 26 44 96 44s96-14 96-44c0-44-44-84-96-84z"/></g></svg>`,
  );

/**
 * Web App Manifest de la pantalla de reparto: permite "instalarla" como ícono en el celular
 * del cadete (display standalone). Alcanza para uno o pocos repartidores; app nativa con GPS
 * en vivo queda para cuando se escale (roadmap).
 */
export function GET() {
  return NextResponse.json(
    {
      name: "Reparto — Pet Shop",
      short_name: "Reparto",
      start_url: "/reparto",
      scope: "/reparto",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#2E7D32",
      icons: [
        { src: ICON, sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
