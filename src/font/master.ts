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

import { cloneGlyph, type Glyph, type Typeface, type Vec2 } from "./types";
import { blendStrokes, inkOf, strokesAgree } from "@/quill/written";
import { normalise, regionOf, scalarAt, type Axis } from "./variable";

/** The axis a second weight sits on, as the format numbers it. */
export const WGHT = "wght";

/**
 * The axes a person can add a version along, and what each is called.
 *
 * Four-letter tags because that is what the format registers and what every
 * reader looks for; the labels are what goes in the interface and into `name`.
 * `normal` is where a typeface sits when nobody has said otherwise, and `step`
 * is what the number field nudges by -- five units of width is a visible change
 * and one unit is not.
 *
 * `second` is where a second version along this axis usually goes and what the
 * trade calls it, and the two belong together rather than being worked out
 * separately. The first version of this reasoned its way to a direction --
 * away from the middle, towards whichever side had more room -- and put the
 * width axis at 125 while calling it Condensed, which means the opposite. It
 * would have got the slant backwards too: an italic lean is a *negative* slnt,
 * and the room either side of nought is equal.
 *
 * Registered tags only. A custom axis is four letters of somebody's own and a
 * perfectly good thing to want; it is also a thing readers do nothing with
 * unless the font says what it means, so it is not offered here.
 */
export const AXES: ReadonlyArray<{
  tag: string;
  label: string;
  normal: number;
  min: number;
  max: number;
  step: number;
  second: { at: number; name: string };
}> = [
  { tag: "wght", label: "Weight", normal: 400, min: 1, max: 1000, step: 50, second: { at: 700, name: "Bold" } },
  { tag: "wdth", label: "Width", normal: 100, min: 25, max: 200, step: 5, second: { at: 75, name: "Condensed" } },
  { tag: "slnt", label: "Slant", normal: 0, min: -90, max: 90, step: 2, second: { at: -12, name: "Italic" } },
  { tag: "opsz", label: "Optical size", normal: 14, min: 5, max: 144, step: 2, second: { at: 60, name: "Display" } },
];

/** What a tag is called on screen, and what it does when nobody has said. */
export function axisSpec(tag: string): (typeof AXES)[number] {
  return (
    AXES.find((one) => one.tag === tag) ?? {
      tag,
      label: tag,
      normal: 0,
      min: -1000,
      max: 1000,
      step: 1,
      second: { at: 1, name: tag },
    }
  );
}

/**
 * The axes this typeface varies on, read off where its versions sit.
 *
 * Not a second list to keep in step. An axis exists because something was drawn
 * away from the middle of it, its ends are the furthest anything was drawn, and
 * its default is where the first version stands -- which is the same version
 * `gvar` stores everything else as a difference from. A document cannot then
 * claim an axis it has no drawing for, which is the way this goes wrong: a
 * `wdth` in `fvar` with no master to reach it is a slider that does nothing.
 */
export function axesOf(masters: Master[]): Axis[] {
  const tags: string[] = [];
  for (const master of masters) {
    for (const tag of Object.keys(master.at)) if (!tags.includes(tag)) tags.push(tag);
  }

  const axes: Axis[] = [];
  for (const tag of tags) {
    const spec = axisSpec(tag);
    const places = masters.map((one) => one.at[tag] ?? spec.normal);
    const min = Math.min(...places);
    const max = Math.max(...places);
    // An axis nothing was drawn away from is not an axis.
    if (min === max) continue;
    axes.push({
      tag,
      label: spec.label,
      min,
      default: masters[0]?.at[tag] ?? spec.normal,
      max,
    });
  }
  return axes;
}

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

/**
 * Why this letter will not blend, said about the letter.
 *
 * Compared against the first weight, because that is what the file compares
 * against: `gvar` stores every other master as a difference from the default,
 * so a letter that disagrees with the default has no difference to store no
 * matter how well the others agree with each other.
 *
 * Returns the first disagreement rather than all of them. One sentence is what
 * fits above a canvas, and a letter that does not match the Bold usually does
 * not match the Black either for the same reason.
 */
export function whyItCannotVary(
  name: string,
  masters: Master[],
): { weight: string; said: string } | null {
  if (masters.length < 2) return null;
  const first = masters[0].typeface;
  const at = first.glyphIndex.get(name);
  if (at === undefined) return null;
  const base = first.glyphs[at];

  for (const master of masters.slice(1)) {
    const here = master.typeface.glyphIndex.get(name);
    if (here === undefined) continue;
    const other = master.typeface.glyphs[here];
    if (agrees(base, other)) continue;

    const said =
      base.contours.length !== other.contours.length
        ? `${base.contours.length} path${base.contours.length === 1 ? "" : "s"} in ${masters[0].name} and ${other.contours.length} in ${master.name}`
        : base.components.length !== other.components.length
          ? `${base.components.length} piece${base.components.length === 1 ? "" : "s"} in ${masters[0].name} and ${other.components.length} in ${master.name}`
          : pointsDiffer(base, other, masters[0].name, master.name);
    return { weight: master.name, said };
  }
  return null;
}

/** The first path whose points do not line up, counted. */
function pointsDiffer(base: Glyph, other: Glyph, from: string, to: string): string {
  for (let at = 0; at < base.contours.length; at += 1) {
    const one = base.contours[at].nodes.length;
    const two = other.contours[at]?.nodes.length ?? 0;
    if (one !== two) {
      return `path ${at + 1} has ${one} point${one === 1 ? "" : "s"} in ${from} and ${two} in ${to}`;
    }
    if (base.contours[at].closed !== other.contours[at]?.closed) {
      return `path ${at + 1} is ${base.contours[at].closed ? "closed" : "open"} in ${from} and ${other.contours[at]?.closed ? "closed" : "open"} in ${to}`;
    }
  }
  // Something the comparison catches and the wording above does not, which is
  // still a real answer: the letter cannot vary and this says so plainly.
  return `${from} and ${to} draw it differently`;
}

/**
 * Every letter that will be left standing still while the rest of the font
 * moves.
 *
 * Cheap enough to ask on every render of the grid: contour and component counts
 * only, no geometry, so it is a walk over the glyph list rather than over the
 * drawing.
 */
export function lettersThatCannotVary(masters: Master[]): Set<string> {
  const stuck = new Set<string>();
  if (masters.length < 2) return stuck;
  const first = masters[0].typeface;

  for (const base of first.glyphs) {
    for (const master of masters.slice(1)) {
      const at = master.typeface.glyphIndex.get(base.name);
      if (at === undefined) continue;
      if (agrees(base, master.typeface.glyphs[at])) continue;
      stuck.add(base.name);
      break;
    }
  }
  return stuck;
}

/**
 * The same letter somewhere between the versions it was drawn at.
 *
 * The point of drawing two: everything between them is a font as well, and
 * until you can see one you are drawing the corners of a design space on faith.
 * A reader will show a person 437 as readily as 400, so 437 is worth looking at.
 *
 * This is the reader's own arithmetic rather than an approximation of it: the
 * default's drawing, plus each other version's difference from it scaled by how
 * much that version has to say here. The scale comes from `scalarAt`, which is
 * built on the same `normalise` and `regionOf` that `gvar` is written from, so
 * the letter on screen and the letter in the file are the same computation and
 * not two readings of one specification.
 *
 * It replaced a straight line between the pair either side, which was right and
 * only right along one axis. Two axes are not a line: a Condensed says nothing
 * about weight and applies at every weight, which is a product of tents rather
 * than a walk along a row -- and it is what makes a design space a star rather
 * than a grid, so a Bold Condensed need never be drawn.
 *
 * A version whose drawing does not line up is left out, exactly as `buildGvar`
 * leaves it out: the letter still varies with whatever agrees, and M2 is what
 * says so on the letter. Where nothing agrees the default's own drawing stands,
 * which is what the exported font does with the same letter.
 */
export function glyphAcross(
  name: string,
  masters: Master[],
  at: Record<string, number>,
): Glyph | null {
  if (masters.length < 2) return null;
  const axes = axesOf(masters);
  if (axes.length === 0) return null;

  const index = masters[0].typeface.glyphIndex.get(name);
  if (index === undefined) return null;
  const base = masters[0].typeface.glyphs[index];

  const here = normalise(axes, at);
  const others: Array<{ glyph: Glyph; scalar: number }> = [];
  for (const master of masters.slice(1)) {
    const found = master.typeface.glyphIndex.get(name);
    if (found === undefined) continue;
    const glyph = master.typeface.glyphs[found];
    const scalar = scalarAt(regionOf(axes, master.at, masters), here);
    if (scalar === 0) continue;
    /*
     * Written letters are compared by their strokes and drawn ones by their
     * outlines, because for a written letter the strokes are what was drawn
     * and the outline is what came out of them. Two versions written with the
     * same pen at different angles have outlines with different numbers of
     * points and would be turned away by `agrees`, while the strokes line up
     * exactly.
     */
    const written =
      base.written && !base.written.expanded && glyph.written && !glyph.written.expanded;
    if (written) {
      if (strokesAgree(base.written!.strokes, glyph.written!.strokes))
        others.push({ glyph, scalar });
      continue;
    }
    if (agrees(base, glyph)) others.push({ glyph, scalar });
  }
  if (others.length === 0) return base;

  /*
   * Between two written letters, blend the pen and sweep the result -- and this
   * is the one place the difference is not a nicety.
   *
   * Two versions of a letter written with the same pen held at forty degrees
   * and at a hundred and ten do not differ by moved points. At forty the thick
   * is on one diagonal and at a hundred and ten it is on the other, so halfway
   * between the *outlines* puts the thick in neither place: a letter no pen
   * ever made, and thinner overall than either version, because the two thicks
   * cancel. Halfway between the *pens* is what a hand holding it at
   * seventy-five degrees would write.
   */
  if (base.written && !base.written.expanded) {
    const strokes = blendStrokes(
      base.written.strokes,
      others.map((one) => ({ strokes: one.glyph.written!.strokes, scalar: one.scalar })),
    );
    const outline = moved(base, others);
    return {
      ...outline,
      written: { strokes },
      contours: inkOf(strokes, masters[0].typeface.unitsPerEm ?? 1000),
    };
  }

  return moved(base, others);
}

/**
 * The default's drawing with every other version's difference added in, each
 * scaled by how much it has to say here.
 *
 * Assumes every glyph handed in lines up with the base; `agrees` is what says
 * so, and `glyphAcross` above asks it first.
 */
function moved(base: Glyph, others: Array<{ glyph: Glyph; scalar: number }>): Glyph {
  const sum = (read: (glyph: Glyph) => number): number => {
    let total = read(base);
    for (const other of others) total += (read(other.glyph) - read(base)) * other.scalar;
    return total;
  };

  const point = (read: (glyph: Glyph) => Vec2): Vec2 => ({
    x: sum((glyph) => read(glyph).x),
    y: sum((glyph) => read(glyph).y),
  });

  return {
    ...base,
    advanceWidth: sum((glyph) => glyph.advanceWidth),
    contours: base.contours.map((contour, at) => ({
      closed: contour.closed,
      nodes: contour.nodes.map((node, index) => {
        const of = (glyph: Glyph): (typeof node) => glyph.contours[at].nodes[index];
        return {
          point: point((glyph) => of(glyph).point),
          /*
           * A handle only moves where every version has one. Two drawings that
           * agree about their points can still disagree about whether a node is
           * curved, and half a handle is not a shape.
           */
          handleIn: others.every((other) => of(other.glyph).handleIn) && node.handleIn
            ? point((glyph) => of(glyph).handleIn!)
            : node.handleIn && { ...node.handleIn },
          handleOut: others.every((other) => of(other.glyph).handleOut) && node.handleOut
            ? point((glyph) => of(glyph).handleOut!)
            : node.handleOut && { ...node.handleOut },
          // The node's kind belongs to the drawing rather than to a place
          // between drawings, and every version claims it. The default wins.
          type: node.type,
        };
      }),
    })),
    components: base.components.map((component, at) => ({
      glyphName: component.glyphName,
      transform: {
        a: sum((glyph) => glyph.components[at].transform.a),
        b: sum((glyph) => glyph.components[at].transform.b),
        c: sum((glyph) => glyph.components[at].transform.c),
        d: sum((glyph) => glyph.components[at].transform.d),
        dx: sum((glyph) => glyph.components[at].transform.dx),
        dy: sum((glyph) => glyph.components[at].transform.dy),
      },
    })),
    anchors: base.anchors.map((anchor) => ({ ...anchor })),
  };
}
