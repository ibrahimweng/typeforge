/**
 * Making and unmaking letters: add, remove, rename, duplicate.
 *
 * None of this existed. A font opened here could have its letters redrawn and
 * nothing else -- no letter could be added to it, taken out of it, renamed, or
 * told which character it is. Which made `startBlank` a dead end rather than a
 * beginning: it handed back a typeface with nothing in it, and there was no
 * way to put anything in it.
 *
 * The whole difficulty is in one fact: a glyph's name is not kept only on the
 * glyph. It is written down in eight places, and a rename that misses one
 * leaves a font that still exports but has quietly lost a kern pair, an accent,
 * or a ligature.
 *
 *   1. the glyph's own `name`
 *   2. `glyphIndex`, the map from name to position
 *   3. `kerning`, on either side of every pair
 *   4. `kernClasses`, in either list of every class
 *   5. `alternates`, in the sequences and in both halves of every swap
 *   6. `components`, on every glyph built out of this one
 *   7. `ligatures`, in the run and in the letter it becomes
 *   8. `sets`, in both halves of every swap
 *
 * The last two arrived with the features panel and are the reason this list is
 * worth keeping in one place: six was right for a year, and the seventh and
 * eighth were added by somebody who had to be told they existed.
 *
 * So the functions here take the whole typeface rather than a glyph, and each
 * one is written to touch all eight or to say plainly which it does not.
 *
 * They mutate rather than returning a new typeface, which is what the rest of
 * this document model does and what the store's undo is built to snapshot
 * around.
 */

import type { Contour, Glyph, Typeface, VerticalMetrics } from "./types";
import { DEFAULT_PARAMS } from "./types";

/** The map from name to position, built again from the glyphs themselves. */
export function reindex(typeface: Typeface): void {
  typeface.glyphIndex = new Map(typeface.glyphs.map((glyph, at) => [glyph.name, at]));
}

/**
 * The name every font must carry, and which nobody designs.
 *
 * `.notdef` is what a renderer draws for a character the font has not got, and
 * the format requires it in first position. Every generator here already puts
 * one in -- quill, forge, assemble -- and `startBlank` now does too, because a
 * font that fails its own first check the moment it is made is not a beginning.
 *
 * Which makes `glyphs.length` the wrong question to ask about a new font: it
 * answers one, and the honest answer to "is there anything here" is no. So the
 * five views that show a letter ask `hasLetters` instead.
 */
export const NOTDEF = ".notdef";

/** Whether this font holds anything somebody drew, rather than only `.notdef`. */
export const hasLetters = (typeface: Typeface): boolean =>
  typeface.glyphs.some((glyph) => glyph.name !== NOTDEF);

/** Whether a name is free to use. */
export const nameIsFree = (typeface: Typeface, name: string): boolean =>
  name.length > 0 && !typeface.glyphIndex.has(name);

/**
 * A free name near the one asked for.
 *
 * `a` becomes `a.001`, and again `a.002`. The suffix is the one the format
 * already uses for a variant of a letter -- `a.alt`, `a.sc` -- so a duplicate
 * lands somewhere a font tool will not be surprised to find it.
 */
export function freeNameNear(typeface: Typeface, base: string): string {
  if (nameIsFree(typeface, base)) return base;
  for (let number = 1; number < 1000; number++) {
    const candidate = `${base}.${String(number).padStart(3, "0")}`;
    if (nameIsFree(typeface, candidate)) return candidate;
  }
  return `${base}.${Date.now()}`;
}

/**
 * The box itself, drawn.
 *
 * `.notdef` exists so that a character the font has not got shows as something
 * rather than as nothing -- the hollow rectangle every reader has seen. An
 * empty one defeats the whole purpose: the missing character comes out as
 * blank space, which is indistinguishable from a space that was meant to be
 * there. It also made the new font's grid show `.notdef` as an empty cell,
 * exactly like a letter nobody had drawn yet, when in fact it was finished.
 *
 * Quill, forge and assemble each draw their own, sized off the pen they are
 * drawing with. This one has no pen to measure, so the rule is a fraction of
 * the cap height. The hole winds against the outside, which is what makes it a
 * hole rather than a second box.
 */
export function notdefGlyph(metrics: VerticalMetrics): Glyph {
  const height = metrics.capHeight;
  const width = Math.round(height * 0.52);
  const side = Math.round(height * 0.08);
  const inset = Math.max(8, Math.round(height * 0.06));
  const box = (x: number, y: number, w: number, h: number): Contour => ({
    closed: true,
    nodes: [
      { point: { x, y }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: x + w, y }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: x + w, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x, y: y + h }, handleIn: null, handleOut: null, type: "corner" },
    ],
  });
  const outer = box(side, 0, width, height);
  const inner = box(side + inset, inset, width - inset * 2, height - inset * 2);
  inner.nodes.reverse();
  return {
    ...blankGlyph(NOTDEF),
    advanceWidth: width + side * 2,
    contours: [outer, inner],
    // Not somebody's work in progress: it is the same box in every font.
    dirty: false,
  };
}

/** An empty letter, ready to be drawn in. */
export function blankGlyph(name: string, unicodes: number[] = []): Glyph {
  return {
    name,
    unicodes,
    // Half an em, which is a starting width rather than a claim: it is what a
    // letter is given before anybody has drawn anything to measure.
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: { ...DEFAULT_PARAMS },
    dirty: true,
  };
}

/**
 * Put a new letter in the font.
 *
 * Appended rather than inserted in any order, because the order of the glyph
 * list is the order the exported file lists them in and there is nothing to
 * gain from guessing where somebody wanted it. Returns the glyph, or null when
 * the name is taken -- a font cannot hold two letters of the same name, since
 * the name is how everything else refers to them.
 */
export function addGlyph(
  typeface: Typeface,
  name: string,
  unicodes: number[] = [],
): Glyph | null {
  if (!nameIsFree(typeface, name)) return null;
  const glyph = blankGlyph(name, unicodes);
  typeface.glyphs = [...typeface.glyphs, glyph];
  reindex(typeface);
  return glyph;
}

/**
 * Take a letter out, and every reference to it with it.
 *
 * The references are the point. A pair kerned against a letter that is gone is
 * a pair the exporter cannot write; a class listing it is a class with a hole
 * in it; an accented letter built on it is a letter with a piece missing. All
 * three are cleaned up here rather than left for the exporter to trip over.
 *
 * What this does *not* do is decide whether removing it was wise. A letter
 * with things built on it takes them with it, and the caller is expected to
 * have said so first -- `dependentsOf` in `composite.ts` is how it finds out.
 */
export function removeGlyph(typeface: Typeface, name: string): boolean {
  if (!typeface.glyphIndex.has(name)) return false;

  typeface.glyphs = typeface.glyphs
    .filter((glyph) => glyph.name !== name)
    .map((glyph) =>
      glyph.components.some((component) => component.glyphName === name)
        ? {
            ...glyph,
            components: glyph.components.filter((component) => component.glyphName !== name),
            dirty: true,
          }
        : glyph,
    );

  typeface.kerning = typeface.kerning.filter(
    (pair) => pair.left !== name && pair.right !== name,
  );
  typeface.kernClasses = typeface.kernClasses.map((kernClass) => ({
    ...kernClass,
    left: kernClass.left.filter((one) => one !== name),
    right: kernClass.right.filter((one) => one !== name),
  }));
  typeface.alternates = typeface.alternates
    .map((rule) => ({
      input: rule.input.map((position) => position.filter((one) => one !== name)),
      swaps: rule.swaps.map((swap) => ({
        at: swap.at,
        swap: swap.swap.filter((one) => one.plain !== name && one.alternate !== name),
      })),
    }))
    // A rule whose sequence has an empty position can never match, and one
    // with nothing left to swap does nothing if it does.
    .filter(
      (rule) =>
        rule.input.every((position) => position.length > 0) &&
        rule.swaps.some((swap) => swap.swap.length > 0),
    );

  /*
   * A ligature goes whole or not at all.
   *
   * Trimming the missing letter out of `f i` leaves `f` becoming `fi`, which is
   * not a smaller version of the rule -- it is a font that draws `fi` for every
   * `f` in it. The same for the letter it becomes: a ligature pointing at a
   * glyph that is gone selects nothing, or whatever ends up at that id.
   */
  if (typeface.ligatures) {
    typeface.ligatures = typeface.ligatures.filter(
      (one) => one.ligature !== name && !one.components.includes(name),
    );
  }

  /*
   * A set is a list of independent swaps, so it loses the one and keeps the
   * rest -- taking `a.ss01` out does not say anything about `g.ss01`. A set
   * with nothing left in it is a tag a reader can switch on to no effect.
   */
  if (typeface.sets) {
    typeface.sets = typeface.sets
      .map((set) => ({
        ...set,
        swaps: set.swaps.filter((one) => one.plain !== name && one.alternate !== name),
      }))
      .filter((set) => set.swaps.length > 0);
  }

  reindex(typeface);
  return true;
}

/**
 * Give a letter a different name, everywhere the old one was written.
 *
 * All eight places, and the reason this is worth its own function rather than a
 * line in the store: a rename that reaches seven of them leaves a font that
 * still exports and has quietly lost a kern pair or an accent, which is the
 * kind of fault nobody finds until somebody sets the font in a word.
 */
export function renameGlyph(typeface: Typeface, from: string, to: string): boolean {
  if (from === to) return false;
  if (!typeface.glyphIndex.has(from) || !nameIsFree(typeface, to)) return false;

  const swap = (one: string): string => (one === from ? to : one);

  typeface.glyphs = typeface.glyphs.map((glyph) => {
    const renamed = glyph.name === from ? { ...glyph, name: to, dirty: true } : glyph;
    if (!renamed.components.some((component) => component.glyphName === from)) return renamed;
    return {
      ...renamed,
      components: renamed.components.map((component) => ({
        ...component,
        glyphName: swap(component.glyphName),
      })),
      dirty: true,
    };
  });

  typeface.kerning = typeface.kerning.map((pair) => ({
    ...pair,
    left: swap(pair.left),
    right: swap(pair.right),
  }));
  typeface.kernClasses = typeface.kernClasses.map((kernClass) => ({
    ...kernClass,
    left: kernClass.left.map(swap),
    right: kernClass.right.map(swap),
  }));
  typeface.alternates = typeface.alternates.map((rule) => ({
    input: rule.input.map((position) => position.map(swap)),
    swaps: rule.swaps.map((one) => ({
      at: one.at,
      swap: one.swap.map((pair) => ({ plain: swap(pair.plain), alternate: swap(pair.alternate) })),
    })),
  }));
  if (typeface.ligatures) {
    typeface.ligatures = typeface.ligatures.map((one) => ({
      components: one.components.map(swap),
      ligature: swap(one.ligature),
    }));
  }
  if (typeface.sets) {
    typeface.sets = typeface.sets.map((set) => ({
      ...set,
      swaps: set.swaps.map((one) => ({ plain: swap(one.plain), alternate: swap(one.alternate) })),
    }));
  }

  reindex(typeface);
  return true;
}

/**
 * A copy of a letter under a new name.
 *
 * The drawing, the width, the anchors, the components and the letter's own
 * parameter overrides -- everything that makes it look the way it does. What
 * it does not copy is the codepoints, and that is the whole of the difference
 * between a duplicate and a second original: two glyphs claiming the same
 * character is a font where one of them can never be typed, and the copy is
 * the one that loses.
 */
export function duplicateGlyph(typeface: Typeface, name: string, into: string): Glyph | null {
  const index = typeface.glyphIndex.get(name);
  if (index === undefined || !nameIsFree(typeface, into)) return null;
  const original = typeface.glyphs[index];

  const copy: Glyph = {
    ...original,
    name: into,
    unicodes: [],
    contours: original.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    })),
    components: original.components.map((component) => ({
      ...component,
      transform: { ...component.transform },
    })),
    anchors: original.anchors.map((anchor) => ({ ...anchor })),
    params: { ...original.params },
    dirty: true,
  };

  typeface.glyphs = [...typeface.glyphs, copy];
  reindex(typeface);
  return copy;
}

/**
 * Which glyph already claims a codepoint, if any.
 *
 * Two glyphs claiming the same character is a font where one of them can never
 * be typed, and which one wins is decided by the order they happen to sit in.
 * So it is asked before the codepoint is given rather than reported afterwards
 * by the checks.
 */
export function claimedBy(typeface: Typeface, codepoint: number, except: string): string | null {
  const holder = typeface.glyphs.find(
    (glyph) => glyph.name !== except && glyph.unicodes.includes(codepoint),
  );
  return holder ? holder.name : null;
}
