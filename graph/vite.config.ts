import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server: {
    port: 5471,
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5470",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/ws": { target: "ws://127.0.0.1:5470", ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        galaxy: resolve(__dirname, "galaxy.html"),
      },
      output: {
        manualChunks: {
          recharts: ["recharts"],
          forcegraph: ["react-force-graph-2d"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
