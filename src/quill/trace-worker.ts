/**
 * The tracing, off the main thread.
 *
 * Filling a letter, measuring its distance field and thinning it is a few
 * hundred milliseconds of arithmetic with no waiting in it, and seventy of
 * those in a row is most of a minute during which a tab that did it inline
 * would answer nothing: no scrolling, no cancelling, not even a spinner
 * turning, because the frame that would draw the spinner never gets to run.
 *
 * So it runs here instead, and the only thing this file adds to `tracing.ts` is
 * the plumbing: take a request, report each letter as it is reached, post the
 * result. All the judgement lives next door, where the version that runs
 * without a worker can share it.
 *
 * Errors are caught and posted rather than thrown. An exception inside a worker
 * reaches the page as an `error` event with the message stripped for
 * cross-origin reasons, so a font that failed to parse would arrive as
 * "Script error" and tell nobody anything.
 */

import { traceFont, type TraceMessage, type TraceRequest } from "./tracing";

const say = (message: TraceMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<TraceRequest>) => {
  const { bytes, name } = event.data;
  try {
    const result = await traceFont(new Uint8Array(bytes), name, (progress) =>
      say({ kind: "progress", progress }),
    );
    say({ kind: "done", result });
  } catch (trouble) {
    say({
      kind: "failed",
      why: trouble instanceof Error ? trouble.message : "That file could not be read.",
    });
  }
};
