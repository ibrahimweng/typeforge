/**
 * More than one weight of the same typeface, in one document.
 *
 * A variable font is drawn twice and blended: you draw the Regular, you draw
 * the Bold, and the file carries both plus the difference between them. This is
 * the half of that the application did not have. The writer -- `fvar`, `gvar`
 * with its phantom points, `STAT` -- has taken a list of masters since the
 * forge learned to ship a family in one file; what it was given was masters
 * *synthesised* by moving `params.weight`, which offsets every node along its
 * own normal. That is a machine-made bold: even where a drawn one is optical,
 * thickening a hairline and a stem by the same amount. Nobody ships it.
 *
 * A master here is a whole typeface, because that is what the exporter already
 * takes and what every view in the application already knows how to draw. What
 * makes them one document rather than several is which parts are copied and
 * which are shared, and that line is drawn by what the format can express
 * rather than by taste. See `docs/masters.md`.
 */

import { cloneGlyph, type Glyph, type Typeface } from "./types";

/** The axis a second weight sits on, as the format numbers it. */
export const WGHT = "wght";

export interface Master {
  /** Stable through renaming, so the chips and the store agree about which. */
  id: string;
  /**
   * What it is called: Regular, Bold, Light.
   *
   * Its own field rather than `meta.styleName`, because the meta belongs to the
   * family and is shared. This is the name of one drawing of it.
   */
  name: string;
  /**
   * Where it sits on each axis, by tag.
   *
   * Also its own field rather than `meta.weightClass`, and for the same reason:
   * there is one meta and there are several of these.
   */
  at: Record<string, number>;
  typeface: Typeface;
}

/**
 * What every master copies and what they all share.
 *
 * Shared by reference on purpose, so that renaming the family, moving the
 * x-height or kerning a pair in one weight is the same act in all of them --
 * which is not a convenience but a requirement: the format writes one `name`,
 * one set of vertical metrics and one `GPOS` for the whole variable font, so a
 * document that let them drift would be describing a font that cannot exist.
 *
 * Copied: the glyphs, deeply, and the index into them. Those are the drawing,
 * and the drawing is the whole point of a second master.
 */
export function masterFrom(base: Typeface, name: string, at: Record<string, number>, id: string): Master {
  return {
    id,
    name,
    at: { ...at },
    typeface: {
      ...base,
      glyphs: base.glyphs.map(cloneGlyph),
      glyphIndex: new Map(base.glyphIndex),
    },
  };
}

/**
 * The one master a font has when nobody has asked for a second.
 *
 * Every document has this, including one that will never have another, so that
 * nothing anywhere has to ask "is this a document with masters or without".
 * A font with one weight is a font with one master, and the interface shows
 * nothing about it -- which is the rule this feature is placed under.
 */
export function soleMaster(typeface: Typeface): Master {
  return {
    id: "m1",
    name: typeface.meta.styleName.trim() || "Regular",
    at: { [WGHT]: typeface.meta.weightClass || 400 },
    typeface,
  };
}

/** An id no master in this document is using. */
export function freeMasterId(masters: Master[]): string {
  let n = masters.length + 1;
  const taken = new Set(masters.map((one) => one.id));
  while (taken.has(`m${n}`)) n += 1;
  return `m${n}`;
}

/**
 * A name no master in this document is using, built from the one asked for.
 *
 * Two masters called Bold would be two identically named instances in the
 * exported file, which readers resolve by picking one and dropping the other.
 */
export function freeMasterName(masters: Master[], wanted: string): string {
  const tidy = wanted.trim() || "New weight";
  const taken = new Set(masters.map((one) => one.name.toLowerCase()));
  if (!taken.has(tidy.toLowerCase())) return tidy;
  let n = 2;
  while (taken.has(`${tidy} ${n}`.toLowerCase())) n += 1;
  return `${tidy} ${n}`;
}

/**
 * Make every other master hold the same letters, in the same order, as this one.
 *
 * The glyph list is the one thing that is copied rather than shared and still
 * has to agree: a letter added in the Regular and missing from the Bold is a
 * letter the exported font cannot vary, and worse, it is a difference nobody
 * would think to look for. So adding, removing or renaming a letter is a change
 * to the document rather than to the drawing, and it lands in every weight.
 *
 * A letter that arrives this way is copied from the master it was added in,
 * which is the only drawing of it that exists. It is a starting point, and the
 * compatibility report is what says it has not been drawn here yet.
 */
export function alignMasters(source: Typeface, masters: Master[]): void {
  for (const master of masters) {
    if (master.typeface === source) continue;
    const had = master.typeface.glyphIndex;
    const was = master.typeface.glyphs;
    const glyphs: Glyph[] = [];
    for (const glyph of source.glyphs) {
      const at = had.get(glyph.name);
      // Kept if this master has it, so its drawing survives; copied if not.
      glyphs.push(at === undefined ? cloneGlyph(glyph) : was[at]);
    }
    master.typeface.glyphs = glyphs;
    master.typeface.glyphIndex = new Map(glyphs.map((one, at) => [one.name, at]));
  }
}

/**
 * Every weight put back, from the first one and what was written down.
 *
 * Built by copying the first weight and laying the saved letters over it, which
 * is the same move the document makes for the font itself: re-read the file,
 * lay the touched glyphs on top. A weight is a set of exceptions to the weight
 * before it, so what is on disk is what was drawn and not what was copied.
 */
export function mastersFrom(
  base: Typeface,
  weight: { name: string; at: Record<string, number> } | undefined,
  saved: Array<{ id: string; name: string; at: Record<string, number>; glyphs: Glyph[] }>,
): Master[] {
  const first = soleMaster(base);
  if (weight) {
    first.name = weight.name;
    first.at = { ...weight.at };
  }
  const masters = [first];

  for (const one of saved) {
    if (!one || typeof one.id !== "string" || masters.some((had) => had.id === one.id)) continue;
    const made = masterFrom(base, one.name, one.at ?? {}, one.id);
    for (const glyph of Array.isArray(one.glyphs) ? one.glyphs : []) {
      const at = made.typeface.glyphIndex.get(glyph?.name);
      if (at === undefined) continue;
      made.typeface.glyphs[at] = glyph;
    }
    masters.push(made);
  }
  return masters;
}

/**
 * Give every other master everything this one has except its drawing.
 *
 * Sharing the objects at creation was not enough, and a test said so: kerning a
 * pair *replaces* `typeface.kerning` rather than pushing onto it, so the moment
 * anything shared was written the two masters were holding different arrays and
 * the Bold was unkerned. Undo is the same shape -- it assigns the old fields
 * back onto one typeface -- so the divergence had two doors, not one.
 *
 * So it is stated as a rule and enforced after every change instead: **a master
 * owns its glyphs and shares everything else.** Written as "copy all of it, then
 * put the drawing back", so a field added to `Typeface` later is shared by
 * default, which is the right default -- there is one `name`, one set of
 * vertical metrics and one `GPOS` in the file this all becomes.
 */
export function shareAcross(source: Typeface, masters: Master[]): void {
  for (const master of masters) {
    const to = master.typeface;
    if (to === source) continue;
    const glyphs = to.glyphs;
    const glyphIndex = to.glyphIndex;
    Object.assign(to, source);
    to.glyphs = glyphs;
    to.glyphIndex = glyphIndex;
  }
}

/**
 * Whether two drawings of a letter can be blended.
 *
 * A variable font stores the difference between two sets of points, so the two
 * have to *be* two sets of the same points: the same contours, in the same
 * order, each with the same number of nodes. Anything else and there is no
 * difference to store.
 *
 * Said here rather than found at export, which is far too late: by then the
 * letter has been drawn and the person has gone.
 */
export function agrees(one: Glyph, other: Glyph): boolean {
  if (one.contours.length !== other.contours.length) return false;
  for (let at = 0; at < one.contours.length; at += 1) {
    if (one.contours[at].nodes.length !== other.contours[at].nodes.length) return false;
    if (one.contours[at].closed !== other.contours[at].closed) return false;
  }
  // Components are drawn from other letters, so two masters have to build a
  // composite out of the same pieces in the same order or there is nothing to
  // interpolate between.
  if (one.components.length !== other.components.length) return false;
  for (let at = 0; at < one.components.length; at += 1) {
    if (one.components[at].glyphName !== other.components[at].glyphName) return false;
  }
  return true;
}
