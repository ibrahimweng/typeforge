import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Font parsing is CPU-heavy; keep the worker format ESM so we can move it off
  // the main thread without a bundling step.
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
