import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables the Arena live-preview hostname during local development only.
  allowedDevOrigins: ["**.e2b.app"],
};

export default nextConfig;
