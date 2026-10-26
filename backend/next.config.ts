import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Eigenständiger Server für das Docker-Image (node server.js).
  output: "standalone",
  serverExternalPackages: ["sharp", "bwip-js", "pg"],
  turbopack: {
    // Nur backend/ beobachten – sonst lösen Dateien in <repo>/data (Uploads,
    // Vorschau-Cache, Valhalla) ständig Neuaufbauten und Seiten-Reloads aus.
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
