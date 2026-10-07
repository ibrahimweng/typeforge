/**
 * The letters resolved on threads: the same file as in place, whichever way
 * it went, and in place again whenever a thread lets the pool down.
 *
 * Whether threads were used at all used to hang on the load average, so no
 * test could say which way it had gone. Here each test says.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { exportFont } from "./export";
import { varyByWeight } from "./masters";
import { importFont } from "./parse";
import { type PoolReply, type Thread, resolveAll } from "./resolve-pool";
import { canThread, threadCount } from "./resolve-node";
import { resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import type { Typeface } from "./types";

async function sample(): Promise<Typeface> {
  const bytes = new Uint8Array(readFileSync("src/assets/typeforge-sample.ttf"));
  return (await importFont(bytes, "sample.ttf")).typeface;
}

async function weighted(): Promise<Typeface> {
  const typeface = await sample();
  return { ...typeface, params: { ...typeface.params, weight: typeface.unitsPerEm * 0.03 } };
}

const same = (one: Uint8Array, other: Uint8Array) => Buffer.from(one).equals(Buffer.from(other));

describe("how many threads", () => {
  const was = process.env.TYPEFORGE_THREADS;
  afterEach(() => {
    if (was === undefined) delete process.env.TYPEFORGE_THREADS;
    else process.env.TYPEFORGE_THREADS = was;
  });

  it("is what TYPEFORGE_THREADS says, and the cores less one where it says nothing", () => {
    process.env.TYPEFORGE_THREADS = "3";
    expect(threadCount()).toBe(3);
    process.env.TYPEFORGE_THREADS = "0";
    expect(threadCount()).toBe(0);
    delete process.env.TYPEFORGE_THREADS;
    const cores = threadCount();
    // Twice over, the same: nothing that changes from one moment to the next.
    expect(threadCount()).toBe(cores);
    process.env.TYPEFORGE_THREADS = "lots";
    expect(threadCount()).toBe(cores);
  });

  it("is none at all where TYPEFORGE_THREADS says none", async () => {
    process.env.TYPEFORGE_THREADS = "0";
    expect(await resolveAll([await weighted()], { always: true })).toBeNull();
  });
});

describe.runIf(canThread())("letters resolved on Node's threads", () => {
  it("are the letters resolved in place, to the last digit", async () => {
    const typeface = await weighted();
    const pooled = await resolveAll([typeface], { threads: 2, always: true });
    expect(pooled).not.toBeNull();
    const local = await weighted();
    expect(pooled![0].contours).toEqual(
      local.glyphs.map((glyph) => resolveGlyphContours(glyph, local)),
    );
    expect(pooled![0].advances).toEqual(
      local.glyphs.map((glyph) => resolveAdvanceWidth(glyph, local)),
    );
  });

  it("write the same file as in place, byte for byte", async () => {
    const options = {
      format: "ttf" as const,
      fidelity: "rebuild" as const,
      mergeOverlaps: false,
      now: 0,
    };
    const threaded = await exportFont(await weighted(), {
      ...options,
      resolving: { threads: 2, always: true },
    });
    const inPlace = await exportFont(await weighted(), { ...options, resolving: { threads: 0 } });
    expect(same(threaded.bytes, inPlace.bytes)).toBe(true);
  });

  it("write the same varying file as in place, byte for byte", async () => {
    const write = async (resolving: { threads: number; always?: boolean }) => {
      const typeface = await sample();
      return (
        await exportFont(typeface, {
          format: "ttf",
          fidelity: "rebuild",
          now: 0,
          variable: varyByWeight(typeface)!,
          resolving,
        })
      ).bytes;
    };
    expect(same(await write({ threads: 3, always: true }), await write({ threads: 0 }))).toBe(true);
  });
});

/** Threads that misbehave, each in its own way, counting the ones stopped. */
function misbehaving(how: "error" | "unreadable" | "silent" | "failed" | "late") {
  const started: Array<{ stopped: boolean }> = [];
  const start = (): Thread => {
    const record = { stopped: false };
    started.push(record);
    let answer: (message: PoolReply) => void = () => {};
    let broke: () => void = () => {};
    return {
      post: (message) => {
        if (message.kind !== "batch") return;
        if (how === "error" || how === "unreadable") setTimeout(() => broke(), 5);
        if (how === "failed") setTimeout(() => answer({ kind: "failed", why: "no" }), 5);
        // Answers the first batch and then never again.
        if (how === "late" && message.from === 0)
          setTimeout(
            () =>
              answer({
                kind: "done",
                which: message.which,
                from: message.from,
                contours: [],
                advances: [],
              }),
            5,
          );
      },
      listen: (reply, failed) => {
        answer = reply;
        broke = failed;
      },
      stop: () => {
        record.stopped = true;
      },
    };
  };
  return { start, started };
}

describe("a thread that lets the pool down", () => {
  for (const how of ["error", "unreadable", "failed", "silent", "late"] as const) {
    it(`(${how}) leaves the letters to be resolved in place, and every thread stopped`, async () => {
      const { start, started } = misbehaving(how);
      const at = performance.now();
      const pooled = await resolveAll([await weighted()], {
        start,
        threads: 3,
        always: true,
        patience: 200,
      });
      expect(pooled).toBeNull();
      expect(started.length).toBe(3);
      expect(started.every((one) => one.stopped)).toBe(true);
      // Given up on after the patience, not waited on for ever.
      expect(performance.now() - at).toBeLessThan(10_000);
    });
  }

  it("still writes the file, the same one as in place", async () => {
    const options = {
      format: "ttf" as const,
      fidelity: "rebuild" as const,
      mergeOverlaps: false,
      now: 0,
    };
    const hung = await exportFont(await weighted(), {
      ...options,
      resolving: { start: misbehaving("silent").start, always: true, patience: 100 },
    });
    const inPlace = await exportFont(await weighted(), { ...options, resolving: { threads: 0 } });
    expect(same(hung.bytes, inPlace.bytes)).toBe(true);
  });
});
