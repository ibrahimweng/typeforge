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
  /*
   * No manual chunking, and the drawing engine in particular is not split off.
   *
   * It looks like the obvious win -- grouping src/forge into its own chunk
   * measures 287 kB, 93 kB gzipped, the largest single thing in the build --
   * but naming it a chunk moves nothing. The entry still imports it with a
   * static import of some dozens of bindings, and index.html still preloads
   * it, so the same bytes arrive before the first screen out of a second file.
   *
   * It is reached from the always-loaded half through five separate edges,
   * none of them accidental:
   *
   *   - font/transform.ts takes `shapedInk` from forge/layers, on the
   *     synchronous path that resolves an outline. Every view and the store
   *     call it.
   *   - App.tsx takes `toTypeface` from forge/typeface and the cut and cast
   *     readers from forge/document.
   *   - App.tsx builds `forgeStore` at startup, which imports nine forge
   *     modules.
   *   - project/format.ts -- reading or writing any project file -- needs
   *     forge/document and forge/cut, because a saved project holds a forge.
   *   - The command palette's catalogue enumerates every forge control, and
   *     the palette is on screen from the first render.
   *
   * Splitting `shapedInk`'s own reach out measures 69 kB (23 kB gzipped),
   * leaving 219 kB (71 kB gzipped) that could in principle be deferred. That
   * is worth having, but getting it means changing what the project format
   * and the palette depend on, not this file. Anyone trying should start
   * there, and should expect the outline path to want to become async.
   */
  build: { target: "es2022", sourcemap: false },
});
