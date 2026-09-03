import type { Metadata, Viewport } from "next";
import RepartoClient from "./reparto-client";

export const metadata: Metadata = {
  title: "Reparto — Pet Shop",
  manifest: "/reparto/manifest",
  appleWebApp: { capable: true, title: "Reparto", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2E7D32",
  width: "device-width",
  initialScale: 1,
};

/** Pantalla de reparto (PWA). El detalle está en el cliente. */
export default function RepartoPage() {
  return <RepartoClient />;
}
