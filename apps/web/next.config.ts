import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

export default {
  reactStrictMode: true,
  // Pin discovery to Paige so unrelated lockfiles in a developer's home
  // directory cannot change Turbopack's module and cache boundary.
  turbopack: { root: workspaceRoot },
} satisfies NextConfig;
