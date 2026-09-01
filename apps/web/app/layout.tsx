import type { ReactNode } from "react";

export const metadata = {
  title: "Commerce OS",
  description: "White Label Multi-Tenant Commerce OS",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f7f7f8",
          color: "#111",
        }}
      >
        {children}
      </body>
    </html>
  );
}
