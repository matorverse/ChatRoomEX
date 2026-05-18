import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.18.193", "127.0.0.1", "localhost"],
  serverExternalPackages: ["@prisma/client", "pino"],
  typedRoutes: true
};

export default nextConfig;
