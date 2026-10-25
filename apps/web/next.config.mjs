/**
 * Encabezados de seguridad para todas las respuestas. HSTS ya lo pone Vercel. No hay CSP de
 * scripts/estilos (la tienda usa estilos inline y Google Fonts); sí se bloquea que otro sitio
 * embeba las páginas (clickjacking) y se acotan permisos del navegador. La geolocalización
 * queda permitida para el propio sitio ("Compartir ubicación" en el checkout).
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Los paquetes del monorepo se consumen ya compilados (dist), pero se transpilan por
  // las dudas si se importan como TS en dev.
  transpilePackages: ["@commerce/contracts", "@commerce/platform", "@commerce/modules"],
  // No anunciar el framework en cada respuesta (x-powered-by).
  poweredByHeader: false,
  experimental: {
    // postgres.js es un paquete de servidor; que no intente bundlearlo al cliente.
    serverComponentsExternalPackages: ["postgres"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
