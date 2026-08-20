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
    const bytes = await fromFontsource(font.id, weight, italic, signal);
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
 * The CSS names one file per face, and the pattern that finds it is a plain
 * search for a URL rather than a CSS parser: the answer is four lines long and
 * a parser for it would be more code than the thing it parses.
 */
async function fromGoogle(
  family: string,
  weight: number,
  italic: boolean,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const url = `${GOOGLE_CSS}?family=${encodeURIComponent(family)}:${axis}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`answered ${response.status} for the stylesheet`);
  const css = await response.text();

  const found = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css);
  if (!found) throw new Error("the stylesheet named no font file");

  const file = await fetch(found[1], { signal });
  if (!file.ok) throw new Error(`answered ${file.status} for the font file`);
  return new Uint8Array(await file.arrayBuffer());
}

/** The CDN route: a predictable path, and plain TrueType at the end of it. */
async function fromFontsource(
  id: string,
  weight: number,
  italic: boolean,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const style = italic ? "italic" : "normal";
  const url = `${FONTSOURCE_CDN}/${id}@latest/latin-${weight}-${style}.ttf`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
