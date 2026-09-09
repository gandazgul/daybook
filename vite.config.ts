import { defineConfig } from "vite";
export default defineConfig({
  server: { host: "0.0.0.0", port: 5198, strictPort: true },
  build: {
    license: { fileName: "dependency-licenses.txt" },
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    // Phaser is the entire rendering engine, so its standalone chunk is intentionally large.
    chunkSizeWarningLimit: 1500,
  },
});
