import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/*
 * Whether this run is measuring itself, told to the tests rather than guessed
 * at by them. A worker does not reliably see the flags the run was started
 * with, and `test.env` reaches every one of them.
 */
const measuring = process.argv.includes("--coverage");

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // The browser suite under e2e/ is driven by Playwright, which brings its
    // own runner. Without this, vitest collects those files and fails on them.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    /*
     * Long enough that how fast the machine is stops being part of the result.
     *
     * Vitest allows a test five seconds by default, and that is a sensible
     * figure for a suite of small assertions. This is not one: a test here
     * draws every letter of every one of sixteen faces at four weights and
     * measures the ink, and the honest ones take seconds because there is
     * seconds of drawing in them. Seventy-five of the thousand-odd take longer
     * than two.
     *
     * Left at five, the tests near the line pass or fail by how busy the
     * machine is. Two have already been caught doing it and given a timeout
     * each -- and then a third, `no control is decoration`, went red on a CI
     * runner at 5.4 seconds having taken 4.6 on the machine it was written on,
     * which is 92 per cent of the budget and was never going to hold. Handing
     * out timeouts one at a time only moves the line to whichever test is now
     * closest to it.
     *
     * Thirty seconds is six times the slowest test that does not already ask
     * for more, and the tests that do ask still override it. Nothing waits
     * thirty seconds in the ordinary case: a passing test costs what it costs,
     * and this only changes what happens to one that has genuinely hung.
     */
    env: { MEASURING: measuring ? "1" : "" },
    testTimeout: 30_000,
    /*
     * Coverage, off unless it is asked for.
     *
     * `npm run coverage`. Instrumenting every file costs six times the run --
     * four minutes measured here becomes twenty-six -- and reports nothing the
     * ordinary run needs, so it is not on by default. What it is for is a
     * question about the suite rather than about a change, and it is asked
     * deliberately.
     */
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      /*
       * Every source file, whether a test reaches it or not.
       *
       * With no `include`, only files some test imported are counted, which
       * answers the wrong question: a module with no test at all is exactly
       * what this is for, and leaving it out reports the suite as healthier
       * the less of the application it covers.
       *
       * This used to say so with `all: true` as well. Vitest 4 removed that
       * option -- an `include` now reports every file it matches, reached or
       * not, which is the same thing -- and went on accepting the key without
       * a word, because nothing type checked this file. It is in tsconfig.json's
       * `include` now, and a removed option is an error.
       */
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        /*
         * `src/ui/` is not ours -- see NOTICE.md. Measuring somebody else's
         * component library says nothing about this suite, and it is a big
         * enough share of the tree to move every number if it were counted.
         */
        "src/ui/**",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        // Test data that lives beside what it tests.
        "src/**/*.fixture.ts",
        // The entry point and the type declarations: nothing to execute.
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
