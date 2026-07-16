import type { NextConfig } from "next";

const eveOrigin = process.env.PAIGE_EVE_URL?.replace(/\/+$/, "");

export default {
  reactStrictMode: true,
  async rewrites() {
    return eveOrigin
      ? [
        {
          source: "/eve/:path*",
          destination: `${eveOrigin}/eve/:path*`,
        },
      ]
      : [];
  },
} satisfies NextConfig;
