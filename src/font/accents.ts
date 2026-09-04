/**
 * Building accented letters from the parts already drawn.
 *
 * Most of a professional character set is accented: `á à â ä ã å ā ă ą` are all
 * `a` with something above or below it. Drawing each by hand is both a great
 * deal of work and a maintenance trap, because correcting the `a` then means
 * correcting every one of them again.
 *
 * Which letter is made of which parts is not a judgement call. Unicode already
 * defines it, in the canonical decomposition of every precomposed character, so
 * the recipes are derived rather than typed out. That covers the whole of
 * Latin, Greek, Cyrillic and Vietnamese without a table to maintain.
 */

import { contoursBounds } from "./geometry";
import { resolveComponents } from "./composite";
import type { Anchor, Component, Glyph, Typeface } from "./types";

/**
 * Combining marks, and the names fonts usually give them.
 *
 * A font may carry the combining character itself (`acutecomb`, U+0301) or the
 * spacing one typographers have used since metal type (`acute`, U+00B4). Both
 * are looked for, since real fonts are split between the two conventions.
 */
export const MARK_NAMES: Record<number, string[]> = {
  768: ["gravecomb", "grave"],
  769: ["acutecomb", "acute"],
  770: ["circumflexcomb", "circumflex"],
  771: ["tildecomb", "tilde"],
  772: ["macroncomb", "macron"],
  774: ["brevecomb", "breve"],
  775: ["dotaccentcomb", "dotaccent"],
  776: ["dieresiscomb", "dieresis"],
  778: ["ringcomb", "ring"],
  779: ["hungarumlautcomb", "hungarumlaut"],
  780: ["caroncomb", "caron"],
  786: ["commaturnedabovecomb", "commaturnedabove"],
  806: ["commaaccentcomb", "commaaccent"],
  807: ["cedillacomb", "cedilla"],
  808: ["ogonekcomb", "ogonek"],
  795: ["horncomb", "horn"],
  803: ["dotbelowcomb", "dotbelow"],
  777: ["hookabovecomb", "hookabove"],
};

/** Marks that hang below the letter rather than sitting on top of it. */
const BELOW_MARKS = new Set([0x0327, 0x0328, 0x0323, 0x0326]);

export interface AccentRecipe {
  /** The glyph to build. */
  target: string;
  base: string;
  /** Marks in the order they apply, outward from the base. */
  marks: string[];
}

/**
 * Work out what a precomposed character is made of, using Unicode's own
 * canonical decomposition rather than a hand-written table.
 */
export function decomposeCodepoint(codepoint: number): { base: number; marks: number[] } | null {
  const character = String.fromCodePoint(codepoint);
  const decomposed = character.normalize("NFD");
  if (decomposed === character) return null;

  const parts = [...decomposed].map((part) => part.codePointAt(0)!);
  if (parts.length < 2) return null;
  return { base: parts[0], marks: parts.slice(1) };
}

/**
 * Every accented glyph in the font that could be built from parts already
 * present, whether or not it has been built yet.
 */
export function findRecipes(typeface: Typeface): AccentRecipe[] {
  const byCodepoint = new Map<number, string>();
  const byName = new Map<string, Glyph>();
  for (const glyph of typeface.glyphs) {
    byName.set(glyph.name, glyph);
    for (const codepoint of glyph.unicodes) {
      if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, glyph.name);
    }
  }

  const findMark = (codepoint: number): string | null => {
    const candidates: string[] = [];
    const direct = byCodepoint.get(codepoint);
    if (direct) candidates.push(direct);
    for (const name of MARK_NAMES[codepoint] ?? []) {
      if (byName.has(name) && !candidates.includes(name)) candidates.push(name);
    }

    // A font usually carries both the combining mark and the older spacing one,
    // and builds its accents from whichever it prefers. The one carrying
    // attachment anchors is the one it positions with, so follow that rather
    // than the codepoint, or accents land somewhere the font never put them.
    const anchored = candidates.find((name) =>
      byName.get(name)?.anchors.some((anchor) => anchor.name.startsWith("_")),
    );
    return anchored ?? candidates[0] ?? null;
  };

  const recipes: AccentRecipe[] = [];
  for (const glyph of typeface.glyphs) {
    for (const codepoint of glyph.unicodes) {
      const decomposition = decomposeCodepoint(codepoint);
      if (!decomposition) continue;

      const base = byCodepoint.get(decomposition.base);
      if (!base || base === glyph.name) continue;

      const marks = decomposition.marks.map(findMark);
      if (marks.some((mark) => mark === null)) continue; // a part is missing

      recipes.push({ target: glyph.name, base, marks: marks as string[] });
      break; // one recipe per glyph is enough
    }
  }
  return recipes;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/**
 * Suggest anchors for a glyph from the shape it draws.
 *
 * A base letter gets `top` and `bottom` at the middle of its width, level with
 * the highest and lowest points of the outline. A mark gets the matching entry
 * anchors, placed so that lining them up puts the mark where it belongs.
 *
 * These are a starting position, not an answer. Placing them well is design
 * work, which is why they can be dragged afterwards.
 */
export function suggestAnchors(glyph: Glyph, typeface: Typeface, isMark: boolean): Anchor[] {
  const contours = resolveComponents(glyph, typeface);
  if (contours.length === 0) return [];
  const bounds = contoursBounds(contours);
  const middle = Math.round((bounds.xMin + bounds.xMax) / 2);

  if (isMark) {
    // A mark's entry anchor sits where it should touch the letter: an accent
    // that rides above meets the letter at its own foot, and one that hangs
    // below meets it at its own head.
    return [
      { name: "_top", x: middle, y: Math.round(bounds.yMin) },
      { name: "_bottom", x: middle, y: Math.round(bounds.yMax) },
    ];
  }
  return [
    { name: "top", x: middle, y: Math.round(bounds.yMax) },
    { name: "bottom", x: middle, y: Math.round(bounds.yMin) },
  ];
}

/** Whether a glyph is a combining mark, judged by codepoint then by name. */
export function looksLikeMark(glyph: Glyph): boolean {
  if (glyph.unicodes.some((cp) => cp >= 0x0300 && cp <= 0x036f)) return true;
  const names = new Set(Object.values(MARK_NAMES).flat());
  return names.has(glyph.name);
}

const anchorNamed = (glyph: Glyph, name: string): Anchor | undefined =>
  glyph.anchors.find((anchor) => anchor.name === name);

/**
 * Where a mark has to sit for its entry anchor to meet the base's anchor.
 *
 * Falls back to centring the mark over the base when either anchor is missing,
 * which is what a designer would do by eye before placing anchors properly.
 */
export function placeMark(
  base: Glyph,
  mark: Glyph,
  typeface: Typeface,
  below: boolean,
): Component["transform"] {
  const anchorName = below ? "bottom" : "top";
  const baseAnchor = anchorNamed(base, anchorName);
  const markAnchor = anchorNamed(mark, `_${anchorName}`);

  if (baseAnchor && markAnchor) {
    return {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      dx: Math.round(baseAnchor.x - markAnchor.x),
      dy: Math.round(baseAnchor.y - markAnchor.y),
    };
  }

  const baseBounds = contoursBounds(resolveComponents(base, typeface));
  const markBounds = contoursBounds(resolveComponents(mark, typeface));
  const dx = Math.round(
    (baseBounds.xMin + baseBounds.xMax) / 2 - (markBounds.xMin + markBounds.xMax) / 2,
  );
  const dy = below
    ? Math.round(baseBounds.yMin - markBounds.yMax)
    : Math.round(baseBounds.yMax - markBounds.yMin);
  return { a: 1, b: 0, c: 0, d: 1, dx, dy };
}

/**
 * Work out where a font's anchors are by reading the composites it already has.
 *
 * A font that ships accented letters has already answered the question this
 * feature asks: where does an accent go on this letter. Each existing composite
 * is one observation — the offset between the base and the mark — and fixing
 * the mark's own attachment point turns that into a position for the base's
 * anchor. Deriving them means a font imported from disk rebuilds exactly where
 * it was, instead of at a guessed height.
 *
 * A mark drawn above the letter is measured from its foot, one below from its
 * head, since that is the edge that meets the letter.
 */
export function deriveAnchors(typeface: Typeface): { bases: number; marks: number } {
  interface Observation {
    x: number;
    y: number;
  }
  const baseAnchors = new Map<string, Map<string, Observation[]>>();
  const markAnchors = new Map<string, Map<string, Observation>>();

  const boundsOf = (glyph: Glyph) => contoursBounds(resolveComponents(glyph, typeface));

  for (const glyph of typeface.glyphs) {
    // One base and one mark is the case that can be read unambiguously.
    if (glyph.components.length !== 2) continue;

    const refs = glyph.components.map((component) => {
      const index = typeface.glyphIndex.get(component.glyphName);
      return index === undefined ? null : { component, glyph: typeface.glyphs[index] };
    });
    if (refs.some((ref) => ref === null)) continue;
    const pair = refs as Array<{ component: Component; glyph: Glyph }>;

    // Which is the mark is decided by what the glyph is, not by the order the
    // components happen to be listed in. Getting this from position gave `a`
    // a mark's anchors, because it sits second in some composite somewhere.
    const markSide = pair.findIndex(
      (ref) => looksLikeMark(ref.glyph) || ref.glyph.advanceWidth === 0,
    );
    if (markSide === -1) continue;
    const baseSide = markSide === 0 ? 1 : 0;
    if (looksLikeMark(pair[baseSide].glyph) && pair[baseSide].glyph.advanceWidth === 0) continue;

    const baseRef = pair[baseSide].component;
    const markRef = pair[markSide].component;
    const base = pair[baseSide].glyph;
    const mark = pair[markSide].glyph;

    // What matters is that each part draws something, not that it draws it
    // directly. A mark is often a composite too: `acutecomb` is usually just
    // `acute` shifted, and requiring its own contours skipped every one.
    const baseBounds = boundsOf(base);
    const markBounds = boundsOf(mark);
    if (baseBounds.xMax <= baseBounds.xMin || markBounds.xMax <= markBounds.xMin) continue;
    const markCentre = (markBounds.xMin + markBounds.xMax) / 2;

    // Which side of the letter the mark lands on decides the anchor pair.
    const markTop = markBounds.yMax + markRef.transform.dy;
    const above = markTop > (baseBounds.yMin + baseBounds.yMax) / 2;
    const name = above ? "top" : "bottom";
    const attachY = above ? markBounds.yMin : markBounds.yMax;

    const markEntry = markAnchors.get(mark.name) ?? new Map<string, Observation>();
    markEntry.set(`_${name}`, { x: markCentre, y: attachY });
    markAnchors.set(mark.name, markEntry);

    const observed: Observation = {
      x: markCentre + markRef.transform.dx - baseRef.transform.dx,
      y: attachY + markRef.transform.dy - baseRef.transform.dy,
    };
    const baseEntry = baseAnchors.get(base.name) ?? new Map<string, Observation[]>();
    baseEntry.set(name, [...(baseEntry.get(name) ?? []), observed]);
    baseAnchors.set(base.name, baseEntry);
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  let bases = 0;
  let marks = 0;

  for (const [name, entries] of markAnchors) {
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) continue;
    const glyph = typeface.glyphs[index];
    for (const [anchorName, observation] of entries) {
      if (glyph.anchors.some((a) => a.name === anchorName)) continue;
      glyph.anchors.push({
        name: anchorName,
        x: Math.round(observation.x),
        y: Math.round(observation.y),
      });
    }
    marks++;
  }

  for (const [name, entries] of baseAnchors) {
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) continue;
    const glyph = typeface.glyphs[index];
    for (const [anchorName, observations] of entries) {
      if (glyph.anchors.some((a) => a.name === anchorName)) continue;
      // The median rather than the mean, so one oddly placed accent in the
      // font cannot drag the anchor off where the rest of them agree it is.
      glyph.anchors.push({
        name: anchorName,
        x: Math.round(median(observations.map((o) => o.x))),
        y: Math.round(median(observations.map((o) => o.y))),
      });
    }
    bases++;
  }

  return { bases, marks };
}

/** Whether a mark hangs below the letter, judged by the anchors it carries. */
function attachesBelow(mark: Glyph): boolean {
  const hasBelow = mark.anchors.some((anchor) => anchor.name === "_bottom");
  const hasAbove = mark.anchors.some((anchor) => anchor.name === "_top");
  if (hasBelow !== hasAbove) return hasBelow;
  return mark.unicodes.some((cp) => BELOW_MARKS.has(cp)) || mark.name.includes("below");
}

/** The dotless form to use when a mark would otherwise sit on top of a dot. */
function dottedBaseFor(recipe: AccentRecipe, typeface: Typeface): string | null {
  const dotless = recipe.base === "i" ? "dotlessi" : recipe.base === "j" ? "dotlessj" : null;
  if (!dotless || !typeface.glyphIndex.has(dotless)) return null;

  // Only for marks that go above; a cedilla under an i leaves the dot alone.
  const goesAbove = recipe.marks.some((name) => {
    const index = typeface.glyphIndex.get(name);
    return index !== undefined && !attachesBelow(typeface.glyphs[index]);
  });
  return goesAbove ? dotless : null;
}

export interface BuildResult {
  built: string[];
  skipped: Array<{ target: string; reason: string }>;
}

/**
 * Build the accented glyphs a font has the parts for.
 *
 * Existing outlines are only replaced when asked for, since a designer may have
 * drawn a letter specially rather than composed it.
 */
export function buildAccents(
  typeface: Typeface,
  options: { overwriteDrawn?: boolean; only?: ReadonlySet<string> } = {},
): BuildResult {
  const recipes = findRecipes(typeface);
  const built: string[] = [];
  const skipped: Array<{ target: string; reason: string }> = [];

  for (const recipe of recipes) {
    if (options.only && !options.only.has(recipe.target)) continue;

    const targetIndex = typeface.glyphIndex.get(recipe.target);
    const baseIndex = typeface.glyphIndex.get(recipe.base);
    if (targetIndex === undefined || baseIndex === undefined) continue;

    const target = typeface.glyphs[targetIndex];
    if (target.contours.length > 0 && !options.overwriteDrawn) {
      skipped.push({ target: recipe.target, reason: "drawn by hand" });
      continue;
    }
    if (target.components.length > 0 && !options.overwriteDrawn) {
      // Already composed, and possibly with parts chosen deliberately: some
      // fonts carry a separate accent cut for capitals that no decomposition
      // knows about. Rebuilding would quietly throw that choice away.
      skipped.push({ target: recipe.target, reason: "already built" });
      continue;
    }

    // An accent above an i or a j replaces the dot rather than stacking on it,
    // which is why fonts carry dotless forms. Unicode's decomposition names the
    // dotted letter, so the substitution has to be made here.
    const baseName = dottedBaseFor(recipe, typeface) ?? recipe.base;
    const resolvedBaseIndex = typeface.glyphIndex.get(baseName) ?? baseIndex;
    const base = typeface.glyphs[resolvedBaseIndex];
    const components: Component[] = [
      { glyphName: baseName, transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
    ];

    let placed = true;
    for (const markName of recipe.marks) {
      const markIndex = typeface.glyphIndex.get(markName);
      if (markIndex === undefined) {
        placed = false;
        break;
      }
      const mark = typeface.glyphs[markIndex];
      components.push({
        glyphName: markName,
        transform: placeMark(base, mark, typeface, attachesBelow(mark)),
      });
    }
    if (!placed) {
      skipped.push({ target: recipe.target, reason: "a part is missing" });
      continue;
    }

    target.components = components;
    target.contours = [];
    target.advanceWidth = base.advanceWidth;
    target.dirty = true;
    built.push(recipe.target);
  }

  return { built, skipped };
}
