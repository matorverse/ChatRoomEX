import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "pino"],
  typedRoutes: true
};

export default nextConfig;
