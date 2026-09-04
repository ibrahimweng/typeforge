/**
 * Loading a screen that was left out of the first download, and asking twice.
 *
 * Most of the application's views and every one of its overlays are fetched
 * when they are first shown rather than with the first screen, which is what
 * keeps the opening download to a third of a megabyte. `App.tsx` says which,
 * and why each one is or is not in that set. This is the part that fetches
 * them.
 *
 * ## Why a second attempt is needed at all
 *
 * A module that fails to fetch is remembered as failed. The browser records the
 * failure in its module map against that URL, so importing the same URL again
 * rejects immediately without going near the network -- which is the right
 * behaviour for a module whose absence is permanent, and the wrong one for a
 * response that was simply dropped.
 *
 * On its own that would be a small thing, because the import would happen at
 * the moment somebody clicked and they would be sitting in front of the result.
 * What makes it worth handling is that these chunks are *warmed*: they are
 * fetched at idle, a moment after the first screen is up, so that a button
 * never shows nothing while a chunk arrives. So the fetch happens unattended,
 * on a connection nobody is watching, and one dropped response there is
 * remembered and surfaces much later as a failure on a click that would
 * otherwise have worked.
 *
 * Measured on the built application: drop one chunk while it is being warmed,
 * let the network recover, then open that screen. No second request is made and
 * the application stops with "Typeforge stopped". With this, the same sequence
 * loads the screen.
 *
 * ## Why the second attempt asks for a different URL
 *
 * Because the same one gets the remembered failure rather than the network,
 * which the probe above is exactly the demonstration of: a plain retry rejects
 * without a request. A query string is enough to make it a different URL and
 * changes nothing about what comes back. Nor does it duplicate the application:
 * the chunk's own imports are written into it as their own URLs, so they
 * resolve to the shared chunks already in hand, and what is loaded twice is the
 * one screen rather than the graph under it.
 *
 * ## Where the URL comes from
 *
 * Out of the failure, because that is the only place it is. A bundled dynamic
 * import is rewritten to a hashed chunk path at build time and no API hands
 * that path back. Chromium and Firefox both name the URL in the message they
 * throw. Safari does not -- it says only that importing failed -- so there the
 * second attempt cannot be made, and the failure is passed on as it was before.
 * Better where it can be, no worse where it cannot.
 */

/** What a module has to look like for `React.lazy` to take it. */
export interface Loaded<T> {
  default: T;
}

/**
 * The URL of the chunk a failed dynamic import was reaching for, if it says.
 *
 * Read out of the message rather than matched against a known wording, since
 * the two engines that give it phrase it differently -- "Failed to fetch
 * dynamically imported module: URL" and "error loading dynamically imported
 * module: URL" -- and a third gives no URL at all. Any absolute URL in the
 * message is the one, because there is nothing else in these messages that
 * looks like one.
 *
 * Trailing punctuation is dropped: a message that ends in a full stop would
 * otherwise hand back a URL with a full stop on the end of it, and the retry
 * would ask for a file that is not there.
 */
export function chunkUrlOf(failure: unknown): string | null {
  const said = failure instanceof Error ? failure.message : String(failure);
  const found = /https?:\/\/[^\s"'`)]+/.exec(said);
  if (!found) return null;
  const url = found[0].replace(/[.,;:]+$/, "");
  return url.length > "https://".length ? url : null;
}

/** The mark that says a URL is the second attempt rather than the first. */
const AGAIN = "typeforge-again";

/**
 * What a second attempt should ask for, or nothing if there should not be one.
 *
 * Kept apart from the loading below so that the decision -- which is the whole
 * of what this module is for -- can be stated and checked on its own. Three
 * answers, and each is a policy rather than an implementation detail:
 *
 * A failure that names no URL gets nothing back, because there is nothing to
 * ask for and inventing one would turn a clear failure into a confusing one.
 *
 * A failure whose URL is already a second attempt gets nothing back either. One
 * retry rather than several: a chunk that is not there is not there, and asking
 * repeatedly turns a clear failure into a slow one.
 *
 * Anything else gets the same URL with the mark on it, which is what makes the
 * browser go and look rather than hand back the failure it remembers.
 */
export function secondAskFor(failure: unknown): string | null {
  const url = chunkUrlOf(failure);
  if (url === null || url.includes(AGAIN)) return null;
  return `${url}${url.includes("?") ? "&" : "?"}${AGAIN}=1`;
}

/**
 * Load a module, and if that fails, ask once more for the same file.
 *
 * `pick` names the export wanted, and is applied to whichever attempt supplied
 * the module. Taking it as an argument rather than letting the caller map the
 * first attempt's result is not tidiness: the second attempt imports a URL
 * rather than a specifier, so it hands back the module's own exports and knows
 * nothing of any mapping done to the first. Written the other way round it
 * type-checks, loads the chunk, and gives React a component of `undefined` --
 * which is what it did, and what the measurement on the built application
 * caught: the fetch was fixed and the crash was not.
 */
export async function loadingTwice<M, T>(
  load: () => Promise<M>,
  pick: (module: M) => T,
): Promise<Loaded<T>> {
  let module: M;
  try {
    module = await load();
  } catch (failure) {
    const again = secondAskFor(failure);
    if (again === null) throw failure;
    module = (await import(/* @vite-ignore */ again)) as M;
  }
  return { default: pick(module) };
}
