import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { authConfig } from "./src/auth/settings";

export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) authConfig();
  return {
    async headers() {
      return ["/enter-theme", "/manage/:path*", "/api/manage/:path*"].map((source) => ({ source, headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] }));
    },
    serverExternalPackages: ["@node-rs/argon2"],
    turbopack: { root: process.cwd() },
    outputFileTracingRoot: process.cwd(),
  };
}
