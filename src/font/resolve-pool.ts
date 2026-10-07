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
 * and put back in order. In Node, which has no `Worker`, they are threads of
 * its own (`resolve-node.ts`). Where there are neither, or too little to be
 * worth starting them for, or any of them fails or hangs, the answer is null
 * and the caller resolves them itself, as it always did.
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

/** One worker, of whichever kind: a browser's, or a Node thread. */
export interface Thread {
  post(message: PoolStart | PoolBatch): void;
  listen(reply: (message: PoolReply) => void, failed: () => void): void;
  stop(): void;
}

/** A browser's worker, as a `Thread`. */
function browserThread(): Thread {
  const worker = new Worker(new URL("./resolve-worker.ts", import.meta.url), {
    type: "module",
  });
  return {
    post: (message) => worker.postMessage(message),
    listen: (reply, failed) => {
      worker.onmessage = (event: MessageEvent<PoolReply>) => reply(event.data);
      // A reply that cannot be read is as good as none: see `resolveAll`.
      worker.onmessageerror = () => failed();
      worker.onerror = () => failed();
    },
    stop: () => worker.terminate(),
  };
}

/**
 * Where Node's threads come from, named at run time so that nothing about
 * them is bundled into the page.
 */
const NODE_THREADS = "./resolve-node";

/** How to resolve, for a caller that wants a say. */
export interface PoolOptions {
  /**
   * How many threads to resolve on, at most `MOST`; `0` resolves in place.
   * Unsaid, it is what `TYPEFORGE_THREADS` says in Node, and otherwise the
   * cores there are less one.
   */
  threads?: number;
  /**
   * Start the threads whatever the amount of work, rather than only where
   * there is enough of it to be worth starting them for. For the tests, which
   * must be able to say which way the letters were resolved.
   */
  always?: boolean;
  /**
   * How long a thread may go without answering, in milliseconds, before the
   * pool gives up on all of them and the letters are resolved in place.
   */
  patience?: number;
  /** Where threads come from, in place of a browser's workers or Node's. */
  start?: () => Thread;
}

/** The most threads ever started, whatever is asked for. */
const MOST = 6;

/**
 * How to start a thread here, how many to start, and how much work makes
 * starting them worth it -- or null where there are none to start.
 *
 * Decided by what is asked and what the machine has, and by nothing that
 * changes from one moment to the next: see `threadCount` in `resolve-node.ts`.
 */
async function threads(options: PoolOptions): Promise<{
  start: () => Thread;
  count: number;
  worthIt: number;
} | null> {
  const capped = (count: number) => Math.max(0, Math.min(MOST, Math.floor(count)));
  if (options.start) {
    const count = capped(options.threads ?? 2);
    return count >= 1 ? { start: options.start, count, worthIt: WORTH_IT } : null;
  }
  if (typeof Worker !== "undefined") {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
    const count = capped(options.threads ?? Math.max(1, cores - 1));
    return count >= 1 ? { start: browserThread, count, worthIt: WORTH_IT } : null;
  }
  if (typeof process === "undefined" || !process.versions?.node) return null;
  if (options.threads === 0) return null;
  try {
    const node = (await import(/* @vite-ignore */ NODE_THREADS)) as typeof import("./resolve-node");
    if (!node.canThread()) return null;
    const count = capped(options.threads ?? node.threadCount());
    /*
     * Two at the least unless one was asked for: a thread here starts by
     * reading the source afresh, and a single one of them is the work done in
     * place with seconds of that added on.
     */
    const least = options.threads === undefined ? 2 : 1;
    return count >= least ? { start: node.thread, count, worthIt: NODE_WORTH_IT } : null;
  } catch {
    return null;
  }
}

/** Fewer glyph resolutions than this are done where they are asked for. */
const WORTH_IT = 400;
/**
 * And in Node, which starts a thread by reading the source afresh -- seconds of
 * each thread's time before it resolves a letter, where a browser's worker
 * comes bundled. On DejaVu at two masters a thousand glyphs came out slower on
 * threads than in place, and the whole font faster.
 */
const NODE_WORTH_IT = 5000;
/** Glyphs to a batch: enough to be worth a message, few enough to share out evenly. */
const BATCH = 48;
/**
 * How long a thread may go without a word before it is taken to have hung.
 *
 * A batch is a few dozen letters, a second or so of work even at the heaviest
 * weight with every cut on; the first also waits for a Node thread to read the
 * source, which is seconds on a busy machine. A minute is far past both, and
 * short of anybody giving up on the export.
 */
const PATIENCE = 60_000;

/**
 * Resolve every glyph of each typeface, or null where that should be done in
 * place. The typefaces must be one font at different family parameters, which
 * is what the masters of a varying font are.
 *
 * Null as well where anything goes wrong on the way: a thread that throws,
 * says it failed, sends back what cannot be read, stops, or goes quiet for
 * longer than `patience`. Every thread is stopped then, and the caller
 * resolves the letters itself. Without the last of those, one thread that
 * never answered left the export waiting for ever.
 */
export async function resolveAll(
  typefaces: Typeface[],
  options: PoolOptions = {},
): Promise<Resolved[] | null> {
  if (typefaces.length === 0) return null;
  const first = typefaces[0];
  if (typefaces.some((one) => one.glyphs !== first.glyphs)) return null;
  const glyphs = first.glyphs.length;
  if (glyphs === 0) return null;
  if (!options.always && glyphs * typefaces.length < WORTH_IT) return null;
  const kind = await threads(options);
  if (!kind || (!options.always && glyphs * typefaces.length < kind.worthIt)) return null;
  const { count } = kind;
  const patience = options.patience ?? PATIENCE;

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
  const workers: Thread[] = [];
  const watches: Array<ReturnType<typeof setTimeout> | undefined> = [];
  let settled = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(why));
      };
      let next = 0;
      let left = batches.length;
      const give = (worker: Thread) => {
        if (next < batches.length) worker.post(batches[next++]);
      };
      for (let k = 0; k < Math.min(count, batches.length); k++) {
        const worker = kind.start();
        workers.push(worker);
        // Each thread watched on its own, from whatever was last sent it.
        const watch = () => {
          clearTimeout(watches[k]);
          watches[k] = setTimeout(
            () => fail("A worker resolving the letters stopped answering."),
            patience,
          );
        };
        worker.listen(
          (reply) => {
            if (settled) return;
            if (reply.kind === "failed") {
              fail(reply.why);
              return;
            }
            const into = results[reply.which];
            reply.contours.forEach((contours, at) => {
              into.contours[reply.from + at] = contours;
              into.advances[reply.from + at] = reply.advances[at];
            });
            left--;
            if (left === 0) {
              settled = true;
              resolve();
            } else if (next < batches.length) {
              give(worker);
              watch();
            } else {
              // Nothing more for this one; the others are still watched.
              clearTimeout(watches[k]);
            }
          },
          () => fail("A worker resolving the letters stopped."),
        );
        worker.post(start);
        give(worker);
        watch();
      }
    });
  } catch {
    // Whatever went wrong, the letters can still be resolved in place.
    return null;
  } finally {
    settled = true;
    for (const watch of watches) clearTimeout(watch);
    for (const worker of workers) worker.stop();
  }
  return results;
}
