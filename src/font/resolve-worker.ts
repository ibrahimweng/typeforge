/**
 * Letters resolved off the main thread, for `resolve-pool.ts`.
 *
 * Only the plumbing lives here: take the font once, then batches of glyphs,
 * and answer each batch with what `resolveGlyphContours` and
 * `resolveAdvanceWidth` say about them -- exactly what the page would have
 * worked out, since it is the same code. Errors are posted rather than thrown,
 * for the reason `trace-worker.ts` gives.
 */

import { readyToShape } from "@/forge/layers";
import type { PoolBatch, PoolReply, PoolStart } from "./resolve-pool";
import { anythingCut, resolveAdvanceWidth, resolveGlyphContours } from "./transform";
import type { Typeface } from "./types";

const say = (reply: PoolReply) => (self as unknown as Worker).postMessage(reply);

let typefaces: Typeface[] = [];
let ready: Promise<unknown> = Promise.resolve();

self.onmessage = async (event: MessageEvent<PoolStart | PoolBatch>) => {
  const message = event.data;
  try {
    if (message.kind === "start") {
      typefaces = message.params.map((params) => ({ ...message.typeface, params }));
      // The cutting is fetched on demand, and a letter cut before it arrives is
      // drawn uncut: see `exportFont`, which waits for it the same way.
      if (typefaces.some(anythingCut)) ready = readyToShape();
      return;
    }
    await ready;
    const typeface = typefaces[message.which];
    const contours = [];
    const advances = [];
    for (let index = message.from; index < message.to; index++) {
      const glyph = typeface.glyphs[index];
      contours.push(resolveGlyphContours(glyph, typeface));
      advances.push(resolveAdvanceWidth(glyph, typeface));
    }
    say({ kind: "done", which: message.which, from: message.from, contours, advances });
  } catch (trouble) {
    say({ kind: "failed", why: trouble instanceof Error ? trouble.message : String(trouble) });
  }
};
