/**
 * A deadline for somebody else's server.
 *
 * Every request the library makes goes to a host this application does not
 * run, and `fetch` on its own will wait for one of them for as long as the
 * connection stays open -- which, behind a proxy that swallows the request or
 * on a network that drops packets rather than refusing them, is minutes. The
 * panel said "Fetching…" for all of it, and the only way out was to close the
 * dialog and hope. A service that has not answered in a reasonable time is a
 * service that is down, as far as anybody waiting on it is concerned, and the
 * fallbacks behind each request exist for exactly that case; they cannot run
 * while the first request is still being waited on.
 *
 * The caller's own signal still counts. A font abandoned because somebody
 * clicked the next one down the list is cancelled at once, and that is not a
 * timeout and is not reported as one: `within` only rewrites the error when
 * the deadline is what fired, so the caller can still tell "you asked me to
 * stop" from "they never answered" by looking at its own signal.
 *
 * The signal handed to `work` is meant for every step of the request,
 * including reading the body. The catalogue is half a megabyte of JSON,
 * and a server that sends the headers promptly and then trickles the rest is
 * as stuck as one that sends nothing -- aborting the fetch's signal stops the
 * body read too, so passing it to `fetch` is enough to cover both.
 */
export async function within<T>(
  ms: number,
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  /*
   * A timer of our own rather than `AbortSignal.timeout`, for two reasons.
   * It is cleared the moment the work is done, so a finished request leaves
   * nothing ticking behind it; and it goes through the ordinary `setTimeout`,
   * which the tests can move forward -- `AbortSignal.timeout` runs on a clock
   * of its own that no fake timer reaches, and a test of a twenty-second
   * deadline would have to wait twenty seconds.
   */
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), ms);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    return await work(combined);
  } catch (error) {
    if (deadline.signal.aborted && !signal?.aborted) {
      throw new Error(`did not answer within ${duration(ms)}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} milliseconds`;
  const seconds = Math.round(ms / 1000);
  return seconds === 1 ? "a second" : `${seconds} seconds`;
}

/*
 * How long each kind of request is given.
 *
 * Generous, because a slow connection is not a broken one and the fallback is
 * worse than the real thing: the built-in list is forty-odd families, and a
 * second font host is a second round trip. The stylesheet is a few hundred
 * bytes and gets the least. The catalogue is half a megabyte of JSON
 * and gets more. A font file gets the most, since the fallback host serves
 * TrueType rather than WOFF2 and a heavy family can run to a megabyte on a
 * phone's connection.
 */
export const CATALOGUE_TIMEOUT = 20_000;
export const STYLESHEET_TIMEOUT = 10_000;
export const FONT_FILE_TIMEOUT = 30_000;
