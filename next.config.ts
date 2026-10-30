import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { authConfig } from "./src/auth/settings";

export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) authConfig();
  return {
    serverExternalPackages: ["@node-rs/argon2"],
    turbopack: { root: process.cwd() },
    outputFileTracingRoot: process.cwd(),
  };
}
