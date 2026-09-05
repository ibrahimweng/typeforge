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
   * bug needs reading -- `MAPS=1 npm run build` -- rather than leaving it on for
   * everyone.
   */
  /*
   * No manual chunking, and none is needed to keep the drawing engine off the
   * first screen.
   *
   * Naming `src/forge` a chunk was always the wrong tool: the entry imported it
   * with a static import of some dozens of bindings, so index.html preloaded
   * the chunk and the same bytes arrived before the first screen out of a
   * second file. What moved it was removing the imports, one edge at a time --
   * the palette catalogue, the project format, the four mode panels, the three
   * document-to-typeface handlers and the three components that wanted a family
   * name or a greyed-out undo button. `state/drawn.ts` is what most of them ask
   * instead.
   *
   * One edge is left and is meant to be: font/transform.ts takes `shapedInk`
   * from forge/layers, on the synchronous path that resolves an outline, which
   * every view and the store call. It brings forge/cut, forge/cast, forge/sweep
   * and forge/shapes with it -- 69 kB, 23 kB gzipped. Moving that one means
   * making the outline path async, which reaches every drawing in the
   * application; it is a different job from this one and a much larger one.
   *
   * Measured with the script in the pull request that did it: the first load
   * -- the entry chunk plus everything it statically imports -- went from
   * 1195 kB (379 kB gzipped) to 781 kB (257 kB gzipped). If you are about to
   * add an import to a component that renders on the first screen, check what
   * it reaches before you do.
   */
  build: { target: "es2022", sourcemap: process.env.MAPS === "1" },
});
