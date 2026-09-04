/**
 * That a screen left out of the first download survives one dropped response.
 *
 * The failure this guards is not hypothetical and not something the browser
 * suite can see. A module that fails to fetch is remembered as failed, so a
 * plain second import of the same URL rejects without a request; and because
 * these chunks are warmed at idle, the drop happens unattended and surfaces
 * later as a crash on a click that would otherwise have worked. Measured on the
 * built application before this: block one chunk while it is warmed, let the
 * network recover, open that screen, and the application stops.
 *
 * The browser suite runs against the dev server, where there are no chunks to
 * drop, so what can be pinned here is the decision-making: which failures get a
 * second attempt, what URL that attempt asks for, and that a failure with
 * nothing to go on is passed on rather than swallowed.
 */

import { describe, expect, it, vi } from "vitest";

import { chunkUrlOf, loadingTwice, secondAskFor } from "./deferred";

describe("chunkUrlOf", () => {
  it("reads the URL out of the message Chromium throws", () => {
    expect(
      chunkUrlOf(
        new TypeError(
          "Failed to fetch dynamically imported module: https://typeforge.app/assets/ForgeView-CgzPjA5Z.js",
        ),
      ),
    ).toBe("https://typeforge.app/assets/ForgeView-CgzPjA5Z.js");
  });

  it("and out of the one Firefox throws, which is worded differently", () => {
    expect(
      chunkUrlOf(
        new TypeError(
          "error loading dynamically imported module: https://typeforge.app/assets/HelpDrawer-B17.js",
        ),
      ),
    ).toBe("https://typeforge.app/assets/HelpDrawer-B17.js");
  });

  /*
   * Safari says only that importing failed. There is nothing to ask again for,
   * and inventing a URL would turn a clear failure into a confusing one.
   */
  it("gives nothing back when the message does not name one", () => {
    expect(chunkUrlOf(new TypeError("Importing a module script failed."))).toBeNull();
  });

  it("does not take the sentence's full stop for part of the URL", () => {
    expect(chunkUrlOf(new Error("could not load https://typeforge.app/assets/a.js."))).toBe(
      "https://typeforge.app/assets/a.js",
    );
  });

  it("survives being handed something that is not an error at all", () => {
    expect(chunkUrlOf("https://typeforge.app/assets/a.js")).toBe(
      "https://typeforge.app/assets/a.js",
    );
    expect(chunkUrlOf(undefined)).toBeNull();
  });
});

describe("secondAskFor", () => {
  /*
   * The marked URL is the whole of the fix: the same one hands back the failure
   * the browser remembers rather than going to look.
   */
  it("asks for the same chunk under a URL the browser has not failed on", () => {
    expect(
      secondAskFor(
        new TypeError(
          "Failed to fetch dynamically imported module: https://typeforge.app/assets/ForgeView-CgzPjA5Z.js",
        ),
      ),
    ).toBe("https://typeforge.app/assets/ForgeView-CgzPjA5Z.js?typeforge-again=1");
  });

  it("joins onto a URL that already carries a query", () => {
    expect(secondAskFor(new Error("failed: https://typeforge.app/a.js?v=2"))).toBe(
      "https://typeforge.app/a.js?v=2&typeforge-again=1",
    );
  });

  it("says not to, when the failure names no URL", () => {
    expect(secondAskFor(new TypeError("Importing a module script failed."))).toBeNull();
  });

  /*
   * And says not to for a second attempt that failed as well. One dropped
   * response is what this is for; a chunk that is not there is not there.
   */
  it("says not to for a URL that is already a second attempt", () => {
    expect(
      secondAskFor(new Error("failed: https://typeforge.app/a.js?typeforge-again=1")),
    ).toBeNull();
  });
});

/*
 * The second attempt itself cannot be driven from here: it imports an absolute
 * URL, and there is no server behind one in this environment. It is checked on
 * the built application instead, by dropping a chunk while it is warmed and
 * opening that screen -- which is the measurement that found the mistake the
 * `pick` argument exists to prevent.
 */
describe("loadingTwice", () => {
  it("asks once when the first ask works, and picks the export asked for", async () => {
    const load = vi.fn().mockResolvedValue({ ForgeView: "the view", other: "not this" });
    await expect(loadingTwice(load, (m: Record<string, string>) => m.ForgeView)).resolves.toEqual({
      default: "the view",
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("passes on a failure that names no URL, since there is nothing to ask for", async () => {
    const said = new TypeError("Importing a module script failed.");
    const load = vi.fn().mockRejectedValue(said);
    await expect(loadingTwice(load, () => "unused")).rejects.toBe(said);
    expect(load).toHaveBeenCalledTimes(1);
  });

  /*
   * And a second attempt is not itself retried. One dropped response is what
   * this is for; a chunk that is not there is not there, and asking repeatedly
   * turns a clear failure into a slow one.
   */
  it("does not try again for a URL that is already a second attempt", async () => {
    const said = new TypeError(
      "Failed to fetch dynamically imported module: https://typeforge.app/assets/a.js?typeforge-again=1",
    );
    const load = vi.fn().mockRejectedValue(said);
    await expect(loadingTwice(load, () => "unused")).rejects.toBe(said);
  });
});
