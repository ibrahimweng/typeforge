/**
 * Threads for `resolve-pool.ts` where there is no `Worker`: Node, which runs
 * the tests, the scripts and anything else that writes a font without a
 * browser.
 *
 * Each thread is a `node:worker_threads` worker running `resolve-thread.ts`,
 * which answers exactly as a browser's worker does, with the same code. Node
 * reads the TypeScript itself, so what a thread cannot do on its own is find
 * the modules by the names this source gives them -- `@/` for the source
 * folder, and no extensions -- and `resolve-hooks.ts` tells it.
 *
 * Only ever imported by name at run time, from `resolve-pool.ts`, so nothing
 * of it reaches a browser.
 */

import { availableParallelism } from "node:os";
import { serialize } from "node:v8";
import { Worker } from "node:worker_threads";

import type { PoolReply, PoolStart, Thread } from "./resolve-pool";

/**
 * Whether this Node reads TypeScript without being asked, which a thread
 * needs in order to run the source as it is. Node 22.18 and later do.
 */
export function canThread(): boolean {
  return Boolean((process.features as { typescript?: string | false }).typescript);
}

/**
 * How many threads to resolve on when nobody has said: one for every core
 * but the one this process is running on.
 *
 * Said by `TYPEFORGE_THREADS` where it is set -- a whole number, and `0` for
 * none at all -- and otherwise worked out from the cores the machine has, and
 * nothing else. It used to be the cores less the load over the last minute,
 * which made whether a font was written on threads or in place depend on what
 * else the machine happened to be doing: the same export took one path on one
 * run and the other on the next, and no test could say which it had tested.
 * A run that shares the machine on purpose -- a test suite with a process for
 * every file -- says so with the variable instead.
 *
 * A value that is not a whole number is ignored rather than guessed at. The
 * pool caps whatever this says (`MOST` in `resolve-pool.ts`).
 */
export function threadCount(): number {
  const said = process.env.TYPEFORGE_THREADS?.trim();
  if (said !== undefined && said !== "") {
    const count = Number(said);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return availableParallelism() - 1;
}

/**
 * The font, written once for every thread.
 *
 * It is ten megabytes and more for an opened font, and `postMessage` copies
 * what it is given for each thread it is sent to: three threads, three copies
 * made one after another on the thread that wants its letters. Written once
 * into memory the threads share, each reads it from there, and nothing writes
 * to it after. The writing is V8's own, the one `postMessage` itself uses, so
 * the font a thread reads is the font it would have been sent.
 */
const shared = new WeakMap<PoolStart, SharedArrayBuffer>();

function sharedStart(start: PoolStart): SharedArrayBuffer {
  let buffer = shared.get(start);
  if (!buffer) {
    const bytes = serialize(start);
    buffer = new SharedArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    shared.set(start, buffer);
  }
  return buffer;
}

export function thread(): Thread {
  const worker = new Worker(new URL("./resolve-thread.ts", import.meta.url));
  return {
    post: (message) =>
      message.kind === "start"
        ? worker.postMessage({ kind: "shared-start", buffer: sharedStart(message) })
        : worker.postMessage(message),
    listen: (reply, failed) => {
      worker.on("message", (message: PoolReply) => reply(message));
      worker.on("messageerror", () => failed());
      worker.on("error", () => failed());
      worker.on("exit", (code) => {
        if (code !== 0) failed();
      });
    },
    stop: () => {
      void worker.terminate();
    },
  };
}
