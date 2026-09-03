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
  /*
   * No sourcemaps in the build that ships. They were 11 MB of the 15 MB output
   * and they publish the full source of `src/ui/`, which is not ours to
   * publish -- see NOTICE.md. Turn this back on locally when a production-only
   * bug needs reading, rather than leaving it on for everyone.
   */
  build: { target: "es2022", sourcemap: false },
});
