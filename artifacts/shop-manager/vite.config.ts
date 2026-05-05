import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Safe defaults
const port = Number(process.env.PORT) || 3000;
const basePath = process.env.BASE_PATH || "/";

// Conditionally include Replit plugins (without async)
const isReplitDev =
  process.env.NODE_ENV !== "production" &&
  process.env.REPL_ID !== undefined;

export default defineConfig({
  base: basePath,

  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(isReplitDev
      ? [
          require("@replit/vite-plugin-cartographer").cartographer({
            root: path.resolve(__dirname, ".."),
          }),
          require("@replit/vite-plugin-dev-banner").devBanner(),
        ]
      : []),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@assets": path.resolve(__dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },

  root: path.resolve(__dirname),

  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },

  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },

  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});