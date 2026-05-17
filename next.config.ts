import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: true
  },
  serverExternalPackages: ["@prisma/client", "pino"],
  typedRoutes: true
};

export default nextConfig;
