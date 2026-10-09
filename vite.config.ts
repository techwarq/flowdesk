import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/backend/**', '**/node_modules/**', '**/.git/**']
    }
  },
  root: "src-ui",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
}));
