import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

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
    testTimeout: 30_000,
  },
});
