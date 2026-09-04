/**
 * Turning what somebody typed, and what the product says about itself, into
 * words that can be compared.
 *
 * The whole quick-action search rests on one piece of luck: every control in
 * this application already carries a sentence saying what it does, written for
 * a designer rather than for a programmer. `PARTS` has a hundred and one of
 * them and `PARAMS` twelve more. That is a corpus, and it is a corpus in
 * exactly the vocabulary somebody would use to describe what they are looking
 * for -- which is what makes "make the letters rounder" findable without a
 * model to understand it.
 *
 * So the matching is done on words, and the work here is making two pieces of
 * English comparable when one of them is a typed fragment and the other is a
 * sentence somebody wrote a year ago.
 */

/**
 * Words too common to tell anything apart.
 *
 * Not a general English stop list -- a list for this corpus. "Letter", "stroke"
 * and "font" are content words in most writing and noise in a font tool, where
 * nearly every sentence has one. Left in, a search for "letter spacing" ranks
 * every control in the product before the one that is about spacing.
 */
const EVERYWHERE = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "do",
  "does",
  "each",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "make",
  "makes",
  "much",
  "not",
  "of",
  "on",
  "one",
  "or",
  "out",
  "over",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "was",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "you",
  "your",
  // The verbs somebody wraps a request in, which say nothing about what they
  // want: "i want feet on the letters" is a query about feet.
  "want",
  "wants",
  "need",
  "needs",
  "get",
  "got",
  "put",
  "give",
  "add",
  "look",
  "looks",
  "looking",
  "seem",
  "seems",
  "my",
  "me",
  "i",
  "too",
  "please",
  "just",
  "very",
  "really",
  "some",
  "any",
  "more",
  "less",
  // And the ones peculiar to this product.
  "font",
  "letter",
  "letters",
  "glyph",
  "glyphs",
  "stroke",
  "strokes",
  "shape",
  "shapes",
  "control",
  "controls",
  "face",
  "faces",
  "typeface",
]);

/**
 * A word reduced to something two spellings of it can share.
 *
 * Deliberately blunt: chop the endings that turn one part of speech into
 * another and stop. A real stemmer would fold "rounder" and "roundness"
 * together and also fold "serif" into "serif" wrongly at the edges, and the
 * cost of being wrong here is a result that does not come back at all.
 *
 * The rule is only applied where something is left worth matching -- "sees"
 * must not become "se" -- which is what the length floors are for.
 */
export function stem(word: string): string {
  let out = word;
  if (out.length > 4 && out.endsWith("ing")) out = out.slice(0, -3);
  else if (out.length > 4 && out.endsWith("ed")) out = out.slice(0, -2);
  else if (out.length > 5 && out.endsWith("ness")) out = out.slice(0, -4);
  else if (out.length > 4 && out.endsWith("er")) out = out.slice(0, -2);
  else if (out.length > 4 && out.endsWith("est")) out = out.slice(0, -3);
  if (out.length > 3 && out.endsWith("ies")) return `${out.slice(0, -3)}y`;
  if (out.length > 3 && out.endsWith("es")) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) out = out.slice(0, -1);
  return out;
}

/**
 * Every word in a piece of text, lowered, stemmed, and with the ones that tell
 * nothing apart dropped.
 *
 * Split on anything that is not a letter or a digit, so "x-height" is two
 * words and "0.5" is one. Hyphenated pairs matter here: somebody typing
 * "x height" and somebody typing "x-height" mean the same thing.
 */
export function wordsOf(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (EVERYWHERE.has(raw)) continue;
    const word = stem(raw);
    if (!word) continue;
    found.push(word);
  }
  return found;
}

/** The same, keeping duplicates out, for indexing rather than for scoring. */
export function uniqueWords(text: string): string[] {
  return [...new Set(wordsOf(text))];
}
