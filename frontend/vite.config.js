import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // В dev-режиме /api → API-сервер
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
