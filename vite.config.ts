import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The headers the deployment sends, sent by `vite preview` too.
 *
 * They live in vercel.json and nowhere else, which meant that nothing but the
 * deployment ever ran the application under them -- and the one that matters,
 * the Content-Security-Policy, can break the application outright without a
 * single test noticing. It has: the WOFF2 decoder is Emscripten output, its
 * bindings are built with `new Function`, and a policy without 'unsafe-eval'
 * made every compressed font -- every font the library fetches -- fail to open
 * in production while the whole suite, run against a dev server with no policy
 * at all, stayed green.
 *
 * So the preview server reads the same file and sends the same headers, and
 * e2e/csp.spec.ts opens a WOFF2 against a built copy of the application under
 * them. Read from vercel.json rather than copied here, so there is one policy
 * and the test is of that one.
 *
 * Preview only, not the dev server. The dev server injects an inline script
 * for React's refresh runtime and talks to itself over a WebSocket, neither of
 * which the policy allows or should; it is a different program from the one
 * that ships, and a policy written for the one that ships would only get in
 * its way.
 *
 * `source` in vercel.json is a path-to-regexp pattern. The two in use --
 * `/(.*)` and `/assets/(.*)` -- are also regular expressions that mean the same
 * thing, and that is all this reads them as; a pattern with named parameters
 * would need more, and would fail the check in e2e/csp.spec.ts rather than
 * quietly match nothing.
 */
function deploymentHeaders(): Plugin {
  interface Rule {
    source: string;
    headers: Array<{ key: string; value: string }>;
  }
  const read = (): Rule[] =>
    (
      JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
        headers?: Rule[];
      }
    ).headers ?? [];

  return {
    name: "typeforge:deployment-headers",
    configurePreviewServer(server) {
      const rules = read().map((rule) => ({
        pattern: new RegExp(`^${rule.source}$`),
        headers: rule.headers,
      }));
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "/").split("?")[0];
        for (const rule of rules) {
          if (!rule.pattern.test(path)) continue;
          for (const { key, value } of rule.headers) response.setHeader(key, value);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), deploymentHeaders()],
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
   * The last edge was font/transform.ts taking `shapedInk` from forge/layers,
   * on the synchronous path that resolves an outline -- which every view and
   * the store call, and which has nowhere in it to await a download. This note
   * used to say that moving it meant making that path async, and that this
   * reached every drawing in the application.
   *
   * It did not. The shaping already answered "not yet" for a living: both
   * layers are boolean geometry, boolean geometry is `paper`, and `paper` is
   * fetched in the background -- so a cut letter has always been drawn plain
   * until the library lands and drawn again when it does. `forge/layers.ts` is
   * now a synchronous gate that asks the same question about one more module,
   * and the redraw that was already waiting for one waits for both. That file
   * has the argument.
   *
   * What is left in the first load of `src/forge` is that gate, at 0.8 kB.
   *
   * Measured with the script in the pull requests that did it: the first load
   * -- the entry chunk plus everything it statically imports -- went from
   * 1195 kB (379 kB gzipped) to 781 kB (257 kB) by removing the imports, and
   * to 751 kB (246 kB) by gating the shaping. That last step is worth eleven
   * kilobytes gzipped rather than the twenty-three this note used to claim:
   * the old figure was the raw size of the modules, and most of what they
   * reach is shared with chunks that were staying anyway. If you are about to
   * add an import to something that renders on the first screen, check what it
   * reaches before you do.
   */
  /*
   * One chunking rule, and it is not the one the note above warns about: React
   * gets a file of its own.
   *
   * react-dom was a third of the entry chunk -- about 180 kB of the 608 kB --
   * and it was what pushed the entry over the 500 kB warning. It is needed on
   * the first screen whatever happens, so this moves no bytes off the first
   * load and is not meant to: index.html preloads the file beside the entry,
   * exactly as it already preloads the small `react` chunk the bundler split
   * out on its own. What it buys is the entry chunk back under the limit and a
   * vendor file whose hash changes when React is upgraded rather than every
   * time the application does, so a returning visitor keeps it in cache.
   *
   * Only these three packages, because everything they match is on the first
   * screen already. A group that matched something only a deferred chunk
   * needs -- the icon set, say -- would pull that into the first load.
   */
  build: {
    target: "es2022",
    sourcemap: process.env.MAPS === "1",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
