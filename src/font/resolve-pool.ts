/**
 * Every letter of a font resolved at once, spread over the cores the browser has.
 *
 * Writing a font resolves every glyph in it once, and a varying one does that
 * for every master: six thousand glyphs of DejaVu weighed at the Regular, the
 * Thin and the Black, each a true offset of its outline (`embolden.ts`). That
 * is a minute or two of arithmetic with no waiting in it, and done on the page
 * it was done on one core while the others sat idle.
 *
 * The letters do not depend on each other, so here they are handed out to a
 * few workers a batch at a time, each running the same `resolveGlyphContours`
 * the page does -- the same code on the same numbers, so the same outlines --
 * and put back in order. Where there are no workers (a test, a server) or too
 * little to be worth starting them for, the answer is null and the caller
 * resolves them itself, as it always did.
 */

import type { Contour, GlyphParams, Typeface } from "./types";

/** What the pool hands back: each typeface's outlines and advances, glyph by glyph. */
export interface Resolved {
  contours: Contour[][];
  advances: number[];
}

/** Sent once to each worker: the font, without what only the writer needs. */
export interface PoolStart {
  kind: "start";
  typeface: Typeface;
  /** One set of family parameters per typeface to resolve: the same font at each. */
  params: GlyphParams[];
}

/** A batch: glyphs `from` up to `to` of typeface number `which`. */
export interface PoolBatch {
  kind: "batch";
  which: number;
  from: number;
  to: number;
}

export type PoolReply =
  | { kind: "done"; which: number; from: number; contours: Contour[][]; advances: number[] }
  | { kind: "failed"; why: string };

/** Fewer glyph resolutions than this are done where they are asked for. */
const WORTH_IT = 400;
/** Glyphs to a batch: enough to be worth a message, few enough to share out evenly. */
const BATCH = 48;

/**
 * Resolve every glyph of each typeface, or null where that should be done in
 * place. The typefaces must be one font at different family parameters, which
 * is what the masters of a varying font are.
 */
export async function resolveAll(typefaces: Typeface[]): Promise<Resolved[] | null> {
  if (typeof Worker === "undefined" || typefaces.length === 0) return null;
  const first = typefaces[0];
  if (typefaces.some((one) => one.glyphs !== first.glyphs)) return null;
  const glyphs = first.glyphs.length;
  if (glyphs * typefaces.length < WORTH_IT) return null;
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  const count = Math.max(1, Math.min(6, cores - 1));

  // The source tables are what a preserving writer copies from, a megabyte or
  // more, and nothing a letter's outline depends on.
  const slim: Typeface = { ...first, source: null };
  const start: PoolStart = {
    kind: "start",
    typeface: slim,
    params: typefaces.map((one) => one.params),
  };

  const batches: PoolBatch[] = [];
  for (let which = 0; which < typefaces.length; which++)
    for (let from = 0; from < glyphs; from += BATCH)
      batches.push({ kind: "batch", which, from, to: Math.min(glyphs, from + BATCH) });

  const results: Resolved[] = typefaces.map(() => ({
    contours: new Array(glyphs),
    advances: new Array(glyphs),
  }));
  const workers: Worker[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let next = 0;
      let left = batches.length;
      const give = (worker: Worker) => {
        if (next < batches.length) worker.postMessage(batches[next++]);
      };
      for (let k = 0; k < count; k++) {
        const worker = new Worker(new URL("./resolve-worker.ts", import.meta.url), {
          type: "module",
        });
        workers.push(worker);
        worker.onmessage = (event: MessageEvent<PoolReply>) => {
          const reply = event.data;
          if (reply.kind === "failed") {
            reject(new Error(reply.why));
            return;
          }
          const into = results[reply.which];
          reply.contours.forEach((contours, k) => {
            into.contours[reply.from + k] = contours;
            into.advances[reply.from + k] = reply.advances[k];
          });
          left--;
          if (left === 0) resolve();
          else give(worker);
        };
        worker.onerror = () => reject(new Error("A worker resolving the letters stopped."));
        worker.postMessage(start);
        give(worker);
      }
    });
  } catch {
    // Whatever went wrong, the letters can still be resolved in place.
    return null;
  } finally {
    for (const worker of workers) worker.terminate();
  }
  return results;
}
