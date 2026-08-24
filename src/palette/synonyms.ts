/**
 * The words somebody reaches for that the product does not use.
 *
 * The hints are written in a typographer's vocabulary, and the person at the
 * keyboard may not have one. They will type "fatter" for weight, "squished"
 * for width, "the hole in the middle" for the counter, and "curly" for a face
 * whose terminals hook. None of those words appear anywhere in the product,
 * so no amount of matching on its own prose will find them.
 *
 * This is the bridge, and it is the one part of the search that has to be
 * written by hand. Each entry maps a word somebody might type onto the words
 * the product actually uses; the search stems both sides, so "fatter" only
 * needs to be listed once to catch "fat" and "fattest" as well.
 *
 * It is deliberately not a thesaurus. Every line here is a word somebody could
 * plausibly type while looking at this application, and the test of whether a
 * line belongs is whether the thing it points at is genuinely what they wanted.
 */
import { stem } from "./words";

export const SYNONYMS: Record<string, string[]> = {
  // How heavy
  fat: ["weight", "heavy", "bold", "thick"],
  fatter: ["weight", "heavy", "bold", "thick"],
  bolder: ["weight", "heavy", "bold"],
  thicker: ["weight", "thick", "stem"],
  thinner: ["weight", "thin", "light", "hairline"],
  lighter: ["weight", "thin", "light"],
  chunky: ["weight", "heavy", "bold", "thick"],
  skinny: ["weight", "thin", "light", "narrow"],
  black: ["weight", "heavy", "bold"],

  // How wide
  squished: ["width", "condensed", "narrow"],
  squeezed: ["width", "condensed", "narrow"],
  cramped: ["width", "condensed", "narrow", "spacing"],
  wider: ["width", "extended", "wide"],
  stretched: ["width", "extended", "wide"],
  narrower: ["width", "condensed", "narrow"],

  // Space
  gap: ["spacing", "sidebearing", "kerning", "aperture"],
  spacing: ["sidebearing", "kerning", "tracking"],
  tracking: ["spacing", "sidebearing"],
  kern: ["kerning", "pair", "spacing"],
  hole: ["counter", "aperture", "bowl"],
  middle: ["counter", "aperture"],
  inside: ["counter", "aperture"],
  loose: ["spacing", "sidebearing", "aperture"],
  tight: ["spacing", "sidebearing", "aperture"],
  close: ["spacing", "sidebearing", "kerning", "tracking"],
  together: ["spacing", "sidebearing", "kerning", "tracking"],
  apart: ["spacing", "sidebearing", "kerning", "tracking"],
  crowded: ["spacing", "sidebearing", "kerning", "tracking"],
  bunched: ["spacing", "sidebearing", "kerning", "tracking"],
  touching: ["spacing", "sidebearing", "kerning", "aperture"],
  colliding: ["spacing", "sidebearing", "kerning"],
  overlapping: ["spacing", "sidebearing", "kerning"],
  far: ["spacing", "sidebearing", "kerning", "tracking"],
  breathing: ["spacing", "sidebearing", "aperture"],

  // Shape
  rounder: ["corner", "radius", "round", "squareness", "roundness"],
  round: ["corner", "radius", "squareness", "roundness"],
  curvy: ["corner", "radius", "round", "squareness"],
  boxy: ["squareness", "square", "corner", "technical"],
  square: ["squareness", "corner"],
  sharp: ["corner", "radius", "square"],
  soft: ["corner", "radius", "round"],
  pointy: ["corner", "apex", "miter"],
  slanted: ["slant", "italic", "oblique", "lean"],
  lean: ["slant", "italic", "oblique"],
  tilt: ["slant", "italic", "oblique"],
  tilted: ["slant", "italic", "oblique"],
  italic: ["slant", "oblique", "lean"],
  oblique: ["slant", "italic", "lean"],
  leaning: ["slant", "italic", "lean"],
  wobbly: ["wave", "ripple", "undulate"],
  wavy: ["wave", "ripple", "undulate"],
  bumpy: ["wave", "ripple"],
  curly: ["terminal", "tail", "hook", "flare"],
  feet: ["serif", "slab", "foot"],
  foot: ["serif", "slab"],
  tail: ["terminal", "descender", "hook"],
  ends: ["terminal", "cap", "serif", "flare"],
  swell: ["flare", "terminal", "brush"],
  swelling: ["flare", "terminal", "brush"],
  contrast: ["thick", "thin", "pen", "modulation"],

  // Vertical
  tall: ["ascender", "height", "capheight", "xheight"],
  taller: ["ascender", "height", "capheight", "xheight"],
  short: ["descender", "xheight", "height"],
  shorter: ["descender", "xheight", "height"],
  height: ["xheight", "capheight", "ascender", "descender"],
  baseline: ["metric", "line"],

  // Doing things
  save: ["keep", "project", "download"],
  open: ["upload", "import", "load", "file"],
  upload: ["open", "import", "load", "file"],
  import: ["open", "upload", "load", "file"],
  download: ["export", "save", "file"],
  export: ["download", "save", "otf", "ttf", "woff", "variable"],
  install: ["export", "download", "otf", "ttf"],
  print: ["export", "specimen"],
  reset: ["clear", "default", "start", "new"],
  restart: ["new", "clear", "start"],
  undo: ["back", "revert"],
  fix: ["report", "check", "validate", "problem"],
  problem: ["report", "check", "validate", "warning"],
  broken: ["report", "check", "validate", "warning"],
  check: ["report", "validate", "problem"],

  // Places
  preview: ["specimen", "sample", "text"],
  sample: ["specimen", "preview", "text"],
  grid: ["overview", "all", "chart", "map"],
  pair: ["kerning", "spacing"],
  measurement: ["metric", "height", "baseline"],
  measurements: ["metric", "height", "baseline"],
};

/**
 * The table with both sides stemmed, built once.
 *
 * The query is stemmed before it gets here -- "fatter" arrives as "fatt" --
 * so a table keyed on the words as written never matches. Stemming the keys
 * has the happy side effect of collapsing the entries that differ only by
 * ending, so "wider" and "widest" both reach the one line for "wide".
 */
const STEMMED: Map<string, string[]> = (() => {
  const out = new Map<string, string[]>();
  for (const [word, listed] of Object.entries(SYNONYMS)) {
    const key = stem(word);
    const values = listed.map(stem);
    const already = out.get(key);
    if (already) out.set(key, [...new Set([...already, ...values])]);
    else out.set(key, values);
  }
  return out;
})();

/**
 * The extra words each typed word implies, kept apart by the word that implied
 * them.
 *
 * Apart, rather than in one list, because they are one piece of evidence and
 * not several. "Fatter" implies weight, heavy, bold and thick; a control whose
 * hint happens to contain three of those has not agreed with the query three
 * times, it has agreed with it once. Summed, the crossbar's thickness -- whose
 * hint says heavy, thick and weight in one sentence -- outranked the weight
 * control itself, which is the thing somebody typing "fatter" wants.
 */
export function impliedBy(words: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const word of words) {
    const listed = STEMMED.get(word);
    if (listed) out.set(word, listed);
  }
  return out;
}
