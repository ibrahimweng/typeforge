/**
 * Letters resolved off the main thread in a browser, for `resolve-pool.ts`.
 *
 * Only the plumbing lives here: what each message is answered with is
 * `resolve-work.ts`, which a Node thread runs as well.
 */

import { answering } from "./resolve-work";

const answer = answering((reply) => (self as unknown as Worker).postMessage(reply));

self.onmessage = (event: MessageEvent) => answer(event.data);
