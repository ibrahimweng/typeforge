/**
 * Getting the actual bytes of a font.
 *
 * Two routes, tried in order, because the catalogue and the files come from
 * different places and either can be unreachable without the other being.
 *
 * Google's stylesheet endpoint is first. Asking it for a family gives back a
 * few lines of CSS naming the file for each weight, and the file is served
 * from a host that sets an open CORS header -- so a browser can fetch it and
 * read the bytes, which is the whole requirement. Fontsource's CDN is second
 * and serves the same families as plain TrueType at a predictable path.
 *
 * What comes back is whatever the host decided to send: a browser gets WOFF2
 * because it says it is a browser, and this application unwraps WOFF2 already,
 * so nothing here has to care which arrived.
 */

import type { LibraryFont } from "./catalogue";
import { FONT_FILE_TIMEOUT, STYLESHEET_TIMEOUT, within } from "./within";

const GOOGLE_CSS = "https://fonts.googleapis.com/css2";
const FONTSOURCE_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

export interface FontRequest {
  font: LibraryFont;
  weight: number;
  italic: boolean;
}

export interface Downloaded {
  bytes: Uint8Array;
  /** What to call it, so the rest of the application can say where it came from. */
  fileName: string;
  from: "google" | "fontsource";
}

/** The weight in the family nearest the one asked for. */
export function nearestWeight(font: LibraryFont, wanted: number): number {
  if (font.weights.length === 0) return 400;
  return font.weights.reduce((best, weight) =>
    Math.abs(weight - wanted) < Math.abs(best - wanted) ? weight : best,
  );
}

/**
 * Fetch one weight of one family.
 *
 * Throws only when both routes fail, and says which failed and why. A font
 * that cannot be fetched is worth a sentence explaining it: the usual cause is
 * a network that blocks one of the two hosts, and knowing which one is the
 * difference between a fixable problem and a mysterious one.
 */
export async function download(request: FontRequest, signal?: AbortSignal): Promise<Downloaded> {
  const { font, italic } = request;
  const weight = nearestWeight(font, request.weight);
  const problems: string[] = [];

  try {
    const bytes = await fromGoogle(font.family, weight, italic, signal);
    return { bytes, fileName: fileNameFor(font, weight, italic), from: "google" };
  } catch (error) {
    problems.push(`Google Fonts: ${reason(error)}`);
  }

  try {
    const bytes = await fromFontsource(font, weight, italic, signal);
    return { bytes, fileName: fileNameFor(font, weight, italic), from: "fontsource" };
  } catch (error) {
    problems.push(`Fontsource: ${reason(error)}`);
  }

  throw new Error(`${font.family} could not be fetched. ${problems.join(" ")}`);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "could not be reached";
}

function fileNameFor(font: LibraryFont, weight: number, italic: boolean): string {
  return `${font.family.replace(/\s+/g, "")}-${weight}${italic ? "italic" : ""}.ttf`;
}

/**
 * The stylesheet route.
 *
 * The CSS names one file per face -- or rather one file per face per script,
 * because Google cuts every family into subsets and a browser asking for the
 * stylesheet is told about all of them: Cyrillic, Greek, Vietnamese, Latin
 * Extended and Latin, each its own `@font-face` with a `unicode-range` saying
 * which characters are in it. A browser putting text on a page downloads only
 * the ones the text needs. This is not putting text on a page; it is taking
 * one file to read the letters out of, and which one matters.
 *
 * This used to take the first URL in the answer, on the understanding that
 * the answer named one file. It names nine for Roboto, and the first is
 * `cyrillic-ext` -- so every family fetched this way arrived with no A to
 * measure, and the measurement came back empty for reasons nobody could see.
 * `pickFontFile` below reads the blocks and chooses the Latin one.
 */
async function fromGoogle(
  family: string,
  weight: number,
  italic: boolean,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const url = `${GOOGLE_CSS}?family=${encodeURIComponent(family)}:${axis}`;
  const css = await within(STYLESHEET_TIMEOUT, signal, async (deadline) => {
    const response = await fetch(url, { signal: deadline });
    if (!response.ok) throw new Error(`answered ${response.status} for the stylesheet`);
    return response.text();
  });

  const found = pickFontFile(css);
  if (!found) throw new Error("the stylesheet named no font file");

  return within(FONT_FILE_TIMEOUT, signal, async (deadline) => {
    const file = await fetch(found, { signal: deadline });
    if (!file.ok) throw new Error(`answered ${file.status} for the font file`);
    return new Uint8Array(await file.arrayBuffer());
  });
}

/** One `@font-face` out of Google's stylesheet, as much of it as matters here. */
interface FaceBlock {
  /** The comment Google puts above each block: `latin`, `cyrillic-ext`, `[3]`. */
  subset: string | null;
  url: string;
  /** Code point ranges, inclusive. Empty when the block did not say, meaning all of them. */
  ranges: Array<[number, number]>;
}

const CAPITAL_A = 0x41;

/**
 * Which of the files a Google stylesheet names to take.
 *
 * In order of preference: the block Google labels `latin`, since that is the
 * subset with the letters this application measures and draws against; then
 * whichever block's `unicode-range` holds a capital A, for a stylesheet whose
 * blocks are not all labelled (Noto Sans JP comes back as a hundred and twenty
 * unlabelled slices of the Japanese before the four named ones, and a change
 * of labelling on Google's side should not send this back to the first); then a block with no range at all, which is how the stylesheet
 * looks when it is served whole to a client that is not a browser; and only
 * then the first file named, because a family with no Latin in it at all is
 * still better opened than refused.
 *
 * A regular expression over the blocks rather than a CSS parser, still: the
 * answer is flat, machine-written and the same shape every time, and a parser
 * for it would be more code than the thing it parses. What changed is that it
 * now reads the whole answer rather than stopping at the first URL in it.
 */
export function pickFontFile(css: string): string | null {
  const blocks: FaceBlock[] = [];
  const face = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(face)) {
    const body = match[2];
    const url = /url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\s*\)/.exec(body);
    if (!url) continue;
    const range = /unicode-range\s*:\s*([^;]+)/.exec(body);
    blocks.push({
      subset: match[1] ?? null,
      url: url[1],
      ranges: range ? readRanges(range[1]) : [],
    });
  }

  const chosen =
    blocks.find((block) => block.subset === "latin") ??
    blocks.find((block) => block.ranges.some(([lo, hi]) => lo <= CAPITAL_A && CAPITAL_A <= hi)) ??
    blocks.find((block) => block.ranges.length === 0) ??
    blocks[0];
  if (chosen) return chosen.url;

  // Not a stylesheet shaped like any Google has sent, but it names a file.
  return /url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)/.exec(css)?.[1] ?? null;
}

/**
 * `U+0000-00FF, U+0131, U+02??` as inclusive ranges. The question-mark form is
 * in the specification and Google does not use it, but it costs one line.
 */
function readRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const part of text.split(",")) {
    const found = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!found) continue;
    const [, first, last] = found;
    const lo = Number.parseInt(first.replace(/\?/g, "0"), 16);
    const hi = last ? Number.parseInt(last, 16) : Number.parseInt(first.replace(/\?/g, "f"), 16);
    if (Number.isFinite(lo) && Number.isFinite(hi)) ranges.push([lo, hi]);
  }
  return ranges;
}

/**
 * Which of a family's subsets to ask the CDN for.
 *
 * Fontsource cuts files the same way Google does and names them by subset, so
 * the path has to say one. It used to say `latin` whatever the family was,
 * and a family with no Latin cut -- thirteen when this was written, the Khmer
 * faces and Karla Tamil among them -- answered 404 every time, with a message
 * that blamed the network. Latin when the family has it, since that is what this
 * application measures; otherwise the first the catalogue listed, which is a
 * font that can at least be opened and looked at.
 */
export function subsetFor(font: LibraryFont): string {
  const subsets = font.subsets ?? [];
  if (subsets.length === 0 || subsets.includes("latin")) return "latin";
  return subsets[0];
}

/** The CDN route: a predictable path, and plain TrueType at the end of it. */
async function fromFontsource(
  font: LibraryFont,
  weight: number,
  italic: boolean,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const style = italic ? "italic" : "normal";
  const url = `${FONTSOURCE_CDN}/${font.id}@latest/${subsetFor(font)}-${weight}-${style}.ttf`;
  return within(FONT_FILE_TIMEOUT, signal, async (deadline) => {
    const response = await fetch(url, { signal: deadline });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
}
