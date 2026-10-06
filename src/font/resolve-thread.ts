/**
 * Letters resolved on a Node thread, for `resolve-pool.ts` by way of
 * `resolve-node.ts`: the Node counterpart of `resolve-worker.ts`.
 *
 * Run by Node as it is, not through Vite, so the source's own names for its
 * modules are taught to Node first (`resolve-hooks.ts`) and everything else
 * is imported after.
 */

import { register } from "node:module";
import { parentPort } from "node:worker_threads";

register(new URL("./resolve-hooks.ts", import.meta.url));

const port = parentPort;
if (port) {
  const work = (await import(
    new URL("./resolve-work.ts", import.meta.url).href
  )) as typeof import("./resolve-work");
  const answer = work.answering((reply) => port.postMessage(reply));
  port.on("message", (message) => void answer(message));
}
