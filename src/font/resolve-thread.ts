/**
 * Letters resolved on a Node thread, for `resolve-pool.ts` by way of
 * `resolve-node.ts`: the Node counterpart of `resolve-worker.ts`.
 *
 * Run by Node as it is, not through Vite, so the source's own names for its
 * modules are taught to Node first (`resolve-hooks.ts`) and everything else
 * is imported after.
 *
 * The font arrives written once in memory every thread shares (see
 * `sharedStart` in `resolve-node.ts`) and is read back here into this
 * thread's own copy; everything else arrives as it was sent.
 */

import { register } from "node:module";
import { deserialize } from "node:v8";
import { parentPort } from "node:worker_threads";

register(new URL("./resolve-hooks.ts", import.meta.url));

const port = parentPort;
if (port) {
  const work = (await import(
    new URL("./resolve-work.ts", import.meta.url).href
  )) as typeof import("./resolve-work");
  const answer = work.answering((reply) => port.postMessage(reply));
  port.on("message", (message) => {
    if (message?.kind === "shared-start") {
      let start: unknown;
      try {
        start = deserialize(new Uint8Array(message.buffer as SharedArrayBuffer));
      } catch (trouble) {
        port.postMessage({
          kind: "failed",
          why: trouble instanceof Error ? trouble.message : String(trouble),
        });
        return;
      }
      void answer(start as Parameters<typeof answer>[0]);
      return;
    }
    void answer(message);
  });
}
