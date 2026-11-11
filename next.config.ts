import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // esbuild ships a native binary; keep it out of the server bundle and trace it as a dependency.
  serverExternalPackages: ["esbuild"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
