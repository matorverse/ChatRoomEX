import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.193"],
  serverExternalPackages: ["@prisma/client", "pino"],
  typedRoutes: true
};

export default nextConfig;
