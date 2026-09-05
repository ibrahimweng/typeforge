/**
 * What somebody is told when a font file will not open.
 *
 * This application parses untrusted binary files -- that is the whole point of
 * it, and `SECURITY.md` says so. A parser fed a damaged file throws, and what
 * it throws lands in the status line verbatim: `store.loadFont` catches and
 * shows `error.message` and nothing else. So the message a reader from three
 * layers down happens to produce is the message a type designer reads.
 *
 * Fuzzing said what those messages actually are. Of four hundred mutations of
 * the bundled sample, a hundred and fifty-two failed to import, and a hundred
 * and twelve of those failed with one of these:
 *
 *     Offset is outside the bounds of the DataView
 *     Cannot read properties of undefined (reading 'compression')
 *     Invalid array length
 *
 * Seventy-four per cent, and not one of them names a font, a file, or anything
 * the person could do next. Every truncated file gives the first one, so a
 * download that stopped early -- the commonest damage there is -- reads as the
 * application breaking rather than the file being short.
 *
 * So a reader that means to turn a file away throws `FontFileError`, and
 * anything else that escapes is wrapped by `unreadable` into one that says
 * what happened in words. The original is kept as `cause`, where a console and
 * a stack trace will find it.
 *
 * Kept there and nowhere else, which was not the first attempt. Appending it
 * to the message in brackets seemed a fair trade -- a sentence for the person
 * and the detail for the bug report, in one string -- and the test in
 * `damaged.test.ts` failed it immediately: the status line is one line in a
 * toolbar, and a message ending "(Cannot read properties of undefined (reading
 * 'compression'))" has put the jargon back in front of exactly the person it
 * was taken away from. The message is for reading. `cause` is for diagnosing.
 */

/**
 * An error whose message was written for the person who will read it.
 *
 * The marker is the whole of it. `unreadable` needs to tell a message somebody
 * meant from a message that fell out of a `DataView`, and there is no way to
 * do that by reading the text: "cmap table version should be 0" is a sentence
 * too, and it is no more use to a type designer than the offset one. Only the
 * code that raised it knows whether it was meant.
 */
export class FontFileError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FontFileError";
  }
}

/**
 * The same thing said about a file, for a failure nobody wrote a message for.
 *
 * Damaged rather than wrong: by the time this is reached the first four bytes
 * have already been recognised, so the file is a font that has been cut short,
 * altered, or written by something that got it wrong. Saying "not a font"
 * there would be false, and it is the sentence that sends somebody looking for
 * the wrong file.
 */
export function unreadable(fileName: string, cause: unknown): FontFileError {
  return new FontFileError(
    `${fileName} could not be read. The file looks like a font but is damaged or incomplete.` +
      " Try downloading it again.",
    { cause },
  );
}
