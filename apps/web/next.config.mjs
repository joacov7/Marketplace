/** @type {import('next').NextConfig} */
const nextConfig = {
  // Los paquetes del monorepo se consumen ya compilados (dist), pero se transpilan por
  // las dudas si se importan como TS en dev.
  transpilePackages: ["@commerce/contracts", "@commerce/platform", "@commerce/modules"],
  experimental: {
    // postgres.js es un paquete de servidor; que no intente bundlearlo al cliente.
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
