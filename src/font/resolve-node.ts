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

import { availableParallelism, loadavg } from "node:os";
import { Worker } from "node:worker_threads";

import type { PoolReply, Thread } from "./resolve-pool";

/**
 * Whether this Node reads TypeScript without being asked, which a thread
 * needs in order to run the source as it is. Node 22.18 and later do.
 */
export function canThread(): boolean {
  return Boolean((process.features as { typescript?: string | false }).typescript);
}

/**
 * How many cores nothing else is busy on: all of them, less the load on the
 * machine over the last minute, which counts this process's own thread too.
 *
 * Threads only pay where there are idle cores to run them on. On a busy
 * machine -- a test run with every file in a process of its own -- three more
 * threads each reading the source and warming up only fight the rest for the
 * same cores: an opened font with slots cut in it took longer to write on
 * threads than in place, and past the time its test allows.
 */
export function idleCores(): number {
  return Math.floor(availableParallelism() - loadavg()[0]);
}

export function thread(): Thread {
  const worker = new Worker(new URL("./resolve-thread.ts", import.meta.url));
  return {
    post: (message) => worker.postMessage(message),
    listen: (reply, failed) => {
      worker.on("message", (message: PoolReply) => reply(message));
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
