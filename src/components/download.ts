/**
 * Handing a file to the browser to save.
 *
 * There is no API for "save this", so every download here is the same four
 * lines: make an object URL for the bytes, point a link at it, click the link,
 * and give the URL back. Seven places wrote those four lines, and six of them
 * gave the URL back on the very next line -- which works in Chromium and
 * Firefox, and in Safari quietly does nothing at all. Safari starts the
 * download after the click has returned, and by then the URL it was told to
 * fetch had been revoked, so the Download button closed the dialog, said the
 * font had been written, and no file arrived.
 *
 * The seventh, saving a project, already knew: it waited ten seconds. That is
 * the one kept, and it is here so there is one copy of it rather than one
 * right answer among six wrong ones.
 */

/**
 * How long the URL is kept after the click.
 *
 * Long enough for any browser to have started reading it, and a URL held a
 * little longer than needed costs only the memory of one file for a few
 * seconds. There is no event that says the browser has finished with it.
 */
export const KEEP_URL_FOR = 10_000;

export function downloadBlob(
  blob: Blob,
  fileName: string,
  within: {
    doc?: Pick<Document, "createElement">;
    later?: (run: () => void, ms: number) => unknown;
  } = {},
): void {
  const doc = within.doc ?? document;
  const later = within.later ?? ((run, ms) => setTimeout(run, ms));
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Given back after the click rather than immediately: revoked too early,
  // Safari has already thrown the download away.
  later(() => URL.revokeObjectURL(url), KEEP_URL_FOR);
}
