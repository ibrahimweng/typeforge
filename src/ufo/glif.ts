/**
 * One glyph, as a UFO stores it and as this application holds it.
 *
 * A `.glif` file is a glyph: its advance, the characters that map to it, its
 * outline, its components and its anchors. The outline is where the work is,
 * and the reason is that UFO describes a contour as a flat run of points where
 * this application describes it as a run of nodes.
 *
 * The difference is where the handles live. A node here owns the handle
 * arriving at it and the handle leaving it; a GLIF point list is the same
 * information laid out end to end, with the off-curve points sitting between
 * the on-curve ones they belong to. Going between the two is a walk, and it has
 * three traps in it.
 *
 * The first is the wrap. A closed contour's point list is cyclic, so off-curve
 * points at the end of the list belong to the segment arriving at the point at
 * the *start* of it. Read left to right and stopped at the end, the last
 * segment of every closed contour loses its curve and comes back a straight
 * line. `glyf` has the same trap and `quadratic.ts` solves it the same way.
 *
 * The second is `qcurve`. A UFO made by converting a TrueType font stores
 * quadratic curves, and a quadratic segment may carry any number of control
 * points with on-curve points implied at the midpoints between them. One point
 * in the file can therefore become several nodes here, so this cannot be a
 * point-for-point translation.
 *
 * The third is that a closed contour is not required to start at an on-curve
 * point, and in a converted font frequently does not -- a circle drawn in
 * TrueType may have no on-curve points at all. Both cases are rotated or given
 * their implied points rather than dropped, because a contour that vanishes
 * silently is a hole in a letter nobody can account for.
 */

import { quadraticToCubic } from "@/font/quadratic";
import type { Anchor, Component, Contour, Glyph, GlyphNode, Vec2 } from "@/font/types";
import {
  attributes,
  child,
  children,
  escapeXml,
  parseXml,
  XML_DECLARATION,
  type XmlNode,
} from "./xml";

/** What a `<point>` says it is. A point with no type is a control point. */
type PointType = "move" | "line" | "curve" | "qcurve" | "offcurve";

interface RawPoint {
  x: number;
  y: number;
  type: PointType;
  smooth: boolean;
}

/** A number from an attribute, or a fallback where it is absent or nonsense. */
function num(node: XmlNode, name: string, fallback: number): number {
  const raw = node.attributes[name];
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function midpoint(one: Vec2, other: Vec2): Vec2 {
  return { x: (one.x + other.x) / 2, y: (one.y + other.y) / 2 };
}

/** One segment of a contour, already reduced to a cubic. */
interface Segment {
  /** The handle leaving the previous point, if the segment is curved. */
  out: Vec2 | null;
  /** The handle arriving at this one. */
  in: Vec2 | null;
  to: Vec2;
  smooth: boolean;
}

/**
 * A `qcurve` segment, as however many cubics it takes.
 *
 * TrueType lets a run of control points stand for a run of quadratic curves
 * joined at the midpoints between them, and writes only the controls. So `n`
 * control points are `n` curves, and all but the last of them end at a point
 * that is nowhere in the file.
 */
function quadraticSegments(from: Vec2, controls: Vec2[], to: Vec2, smooth: boolean): Segment[] {
  const out: Segment[] = [];
  let start = from;
  for (let at = 0; at < controls.length; at++) {
    const last = at === controls.length - 1;
    const end = last ? to : midpoint(controls[at], controls[at + 1]);
    const { c1, c2 } = quadraticToCubic(start, controls[at], end);
    // An implied point sits in the middle of a curve that does not turn, so it
    // is smooth by construction; the one the file actually named keeps what the
    // file said about it.
    out.push({ out: c1, in: c2, to: end, smooth: last ? smooth : true });
    start = end;
  }
  return out;
}

/** The points of one `<contour>`, as a contour of nodes. */
function contourOf(node: XmlNode): Contour | null {
  const points: RawPoint[] = children(node, "point").map((one) => ({
    x: num(one, "x", 0),
    y: num(one, "y", 0),
    type: (one.attributes.type as PointType | undefined) ?? "offcurve",
    smooth: one.attributes.smooth === "yes",
  }));
  if (points.length === 0) return null;

  const closed = points[0].type !== "move";

  /*
   * A single point on its own.
   *
   * UFO 1 and 2 wrote anchors this way -- a closed contour of one point, with
   * the anchor's name on it. It is not an outline and it is read as one here
   * only so far as keeping it from becoming a node with nothing attached.
   */
  if (points.length === 1) {
    if (points[0].type === "offcurve") return null;
    return {
      closed,
      nodes: [
        {
          point: { x: points[0].x, y: points[0].y },
          handleIn: null,
          handleOut: null,
          type: "corner",
        },
      ],
    };
  }

  let ordered = points;
  if (closed) {
    const first = points.findIndex((one) => one.type !== "offcurve");
    if (first === -1) {
      /*
       * Every point a control point, which TrueType allows and which a
       * converted font really contains: a circle of four quadratic arcs whose
       * on-curve points are all implied. The first implied point is the
       * midpoint of the last control and the first, and inserting it turns the
       * contour into one the walk below can read.
       */
      const implied = midpoint(points[points.length - 1], points[0]);
      ordered = [{ x: implied.x, y: implied.y, type: "qcurve", smooth: true }, ...points];
    } else if (first > 0) {
      ordered = [...points.slice(first), ...points.slice(0, first)];
    }
  }

  /*
   * The walk, in one pass, with the wrap handled by walking one place further
   * than the list is long on a closed contour: that last step is the segment
   * back to the point it started from.
   */
  const start: Vec2 = { x: ordered[0].x, y: ordered[0].y };
  const segments: Segment[] = [];
  let controls: Vec2[] = [];
  let from = start;

  const steps = closed ? ordered.length : ordered.length - 1;
  for (let step = 0; step < steps; step++) {
    const point = ordered[(step + 1) % ordered.length];
    if (point.type === "offcurve") {
      controls.push({ x: point.x, y: point.y });
      continue;
    }
    const to: Vec2 = { x: point.x, y: point.y };
    if (point.type === "qcurve") {
      const made = quadraticSegments(from, controls, to, point.smooth);
      // No controls at all is a straight line however it was labelled.
      segments.push(
        ...(made.length > 0 ? made : [{ out: null, in: null, to, smooth: point.smooth }]),
      );
    } else {
      // `curve` takes the two controls before it; `line` takes none. A curve
      // written with one control, which the format permits, keeps the one it
      // has on the side it was given.
      const curved = point.type === "curve" && controls.length > 0;
      segments.push({
        out: curved ? controls[0] : null,
        in: curved ? controls[controls.length - 1] : null,
        to,
        smooth: point.smooth,
      });
    }
    from = segments[segments.length - 1].to;
    controls = [];
  }

  if (segments.length === 0) return null;

  /*
   * Segments to nodes.
   *
   * A node holds the handle arriving at it and the handle leaving it, so each
   * takes its `in` from the segment that ends on it and its `out` from the one
   * that starts there. The two kinds of contour count differently and that is
   * the whole of the arithmetic here: a closed contour of `n` segments has `n`
   * nodes, because the last segment ends where the first began; an open one
   * has `n + 1`, because nothing comes back. Reading the closed case for both
   * is what dropped the last point off every open contour.
   */
  const places: Vec2[] = closed
    ? [start, ...segments.slice(0, -1).map((one) => one.to)]
    : [start, ...segments.map((one) => one.to)];

  const nodes: GlyphNode[] = places.map((point, index) => {
    // On a closed contour the segment arriving at the first node is the last
    // one in the list, which is the wrap coming back to where it should.
    const arriving =
      index === 0 ? (closed ? segments[segments.length - 1] : null) : segments[index - 1];
    const leaving = closed ? segments[index] : (segments[index] ?? null);
    const handleIn = arriving?.in ?? null;
    const handleOut = leaving?.out ?? null;
    return {
      point,
      handleIn,
      handleOut,
      // The file's own word for it, which is a decision somebody made rather
      // than something to be re-derived from the coordinates. A point marked
      // smooth with only one handle is what this model calls a tangent.
      type: arriving?.smooth ? (handleIn && handleOut ? "smooth" : "tangent") : "corner",
    };
  });

  return { closed, nodes };
}

function componentOf(node: XmlNode): Component | null {
  const base = node.attributes.base;
  if (!base) return null;
  return {
    glyphName: base,
    transform: {
      a: num(node, "xScale", 1),
      b: num(node, "xyScale", 0),
      c: num(node, "yxScale", 0),
      d: num(node, "yyScale", 1),
      dx: num(node, "xOffset", 0),
      dy: num(node, "yOffset", 0),
    },
  };
}

/** What a `.glif` file says, as a glyph. Null if it is not one. */
export function readGlif(source: string): Glyph | null {
  const root = parseXml(source);
  if (root?.name !== "glyph") return null;
  const name = root.attributes.name;
  if (!name) return null;

  const advance = child(root, "advance");
  const outline = child(root, "outline");

  const contours: Contour[] = [];
  const components: Component[] = [];
  if (outline) {
    for (const one of outline.children) {
      if (one.name === "contour") {
        const contour = contourOf(one);
        if (contour) contours.push(contour);
      } else if (one.name === "component") {
        const component = componentOf(one);
        if (component) components.push(component);
      }
    }
  }

  const anchors: Anchor[] = children(root, "anchor")
    .filter((one) => one.attributes.name)
    .map((one) => ({ name: one.attributes.name, x: num(one, "x", 0), y: num(one, "y", 0) }));

  const unicodes = children(root, "unicode")
    .map((one) => Number.parseInt(one.attributes.hex ?? "", 16))
    .filter((one) => Number.isFinite(one));

  return {
    name,
    unicodes,
    advanceWidth: advance ? num(advance, "width", 0) : 0,
    contours,
    components,
    anchors,
    params: {},
    dirty: false,
  };
}

/* --- writing ------------------------------------------------------------ */

/** A coordinate, without the trailing zeroes a float turns into. */
function coord(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pointTag(point: Vec2, type: PointType | null, smooth: boolean): string {
  return `      <point${attributes([
    ["x", coord(point.x)],
    ["y", coord(point.y)],
    ["type", type ?? undefined],
    ["smooth", smooth ? "yes" : undefined],
  ])}/>`;
}

/**
 * A contour, as a point list.
 *
 * The reverse of the walk above, and it puts the wrap back: the two controls
 * of the segment that closes a contour go at the end of the list, because that
 * is where a reader expects to find them and where the first point -- already
 * written at the top -- picks them up from.
 *
 * The first version wrote them twice. It emitted each node as "the control
 * leaving the one before, the control arriving here, the point", which is
 * right for every node except the first: the one before the first is the last,
 * so its control went out at the top of the list as well as at the bottom.
 * `fontTools` rejected the result outright -- too many off-curves for one
 * curve -- which is exactly the value of asking somebody else's reader. Nothing
 * written here would have noticed, because the reader upstairs pairs controls
 * from the on-curve point outwards and would have quietly ignored the spares.
 */
function contourTag(contour: Contour): string {
  const { nodes, closed } = contour;
  if (nodes.length === 0) return "";

  const smoothOf = (node: GlyphNode) => node.type === "smooth" || node.type === "tangent";
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  // What kind of point the first one is depends on the segment arriving at it,
  // which on a closed contour is the one written last.
  const closing = closed && Boolean(last.handleOut ?? first.handleIn);

  const lines: string[] = [
    pointTag(first.point, closed ? (closing ? "curve" : "line") : "move", smoothOf(first)),
  ];

  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index];
    const leaving = nodes[index - 1].handleOut;
    if (leaving) lines.push(pointTag(leaving, null, false));
    if (node.handleIn) lines.push(pointTag(node.handleIn, null, false));
    lines.push(pointTag(node.point, (leaving ?? node.handleIn) ? "curve" : "line", smoothOf(node)));
  }

  if (closed && nodes.length > 1) {
    if (last.handleOut) lines.push(pointTag(last.handleOut, null, false));
    if (first.handleIn) lines.push(pointTag(first.handleIn, null, false));
  }

  return `    <contour>\n${lines.join("\n")}\n    </contour>`;
}

function componentTag(component: Component): string {
  const { a, b, c, d, dx, dy } = component.transform;
  return `    <component${attributes([
    ["base", component.glyphName],
    ["xScale", a === 1 ? undefined : coord(a)],
    ["xyScale", b === 0 ? undefined : coord(b)],
    ["yxScale", c === 0 ? undefined : coord(c)],
    ["yyScale", d === 1 ? undefined : coord(d)],
    ["xOffset", dx === 0 ? undefined : coord(dx)],
    ["yOffset", dy === 0 ? undefined : coord(dy)],
  ])}/>`;
}

/** A glyph, as the text of a `.glif` file. */
export function writeGlif(glyph: Glyph): string {
  const lines: string[] = [
    XML_DECLARATION,
    `<glyph${attributes([
      ["name", glyph.name],
      ["format", "2"],
    ])}>`,
    `  <advance${attributes([["width", coord(glyph.advanceWidth)]])}/>`,
  ];

  for (const codepoint of glyph.unicodes) {
    // Four digits at least, upper case, which is what the format asks for and
    // what every other tool writes.
    const hex = codepoint.toString(16).toUpperCase().padStart(4, "0");
    lines.push(`  <unicode${attributes([["hex", hex]])}/>`);
  }

  const inside = [
    ...glyph.contours.map((one) => contourTag(one)).filter(Boolean),
    ...glyph.components.map((one) => componentTag(one)),
  ];
  if (inside.length > 0) {
    lines.push("  <outline>", ...inside, "  </outline>");
  } else {
    lines.push("  <outline/>");
  }

  for (const anchor of glyph.anchors) {
    lines.push(
      `  <anchor${attributes([
        ["name", anchor.name],
        ["x", coord(anchor.x)],
        ["y", coord(anchor.y)],
      ])}/>`,
    );
  }

  lines.push("</glyph>", "");
  return lines.join("\n");
}

/**
 * The file name a glyph is stored under.
 *
 * A UFO lives on a disk, and disks disagree about names: `A` and `a` are the
 * same file on a Mac and different ones on Linux, a handful of characters
 * cannot appear in a name on Windows, and a few whole names are reserved there
 * for devices that stopped existing decades ago. So the format specifies a
 * mangling, and this is it, in the order the reference implementation applies
 * it -- because a UFO written here has to be readable by the Python tools that
 * every other part of this ecosystem is built on, and they agree by following
 * the same steps rather than by arriving at the same answer.
 *
 * The order is what makes `NUL` and `nul` come out differently, which looks
 * wrong until you follow it. Capitals are marked first, so `NUL` is already
 * `N_U_L_` by the time anything asks whether it is reserved, and it is not.
 * `nul` passes the marking untouched and is caught. Both are safe, which is
 * the point; matching the reference exactly is what makes them safe in the
 * same file as everybody else's.
 *
 * The taken names are passed in rather than remembered, because two glyphs
 * whose names differ only in case land on the same file and one of them has to
 * move. `contents.plist` is what says which file is which, so nothing
 * downstream has to reverse any of this.
 */
const ILLEGAL = new Set('"*+/:<>?[\\]|\u007f'.split(""));

const RESERVED = new Set(
  (
    "con prn aux nul com1 com2 com3 com4 com5 com6 com7 com8 com9 " +
    "lpt1 lpt2 lpt3 lpt4 lpt5 lpt6 lpt7 lpt8 lpt9 clock$"
  ).split(" "),
);

export function fileNameFor(glyphName: string, taken: Set<string>): string {
  /*
   * A leading period first, and it is not a corner case: `.notdef` is in every
   * font there has ever been. A file whose name begins with a dot is hidden on
   * every Unix and is a syntax error to some archivers, so the format moves it
   * out of the way before anything else happens.
   */
  const source = glyphName.startsWith(".") ? `_${glyphName.slice(1)}` : glyphName;

  let stem = "";
  for (const character of source) {
    const code = character.codePointAt(0)!;
    if (ILLEGAL.has(character) || code < 0x20) {
      stem += "_";
    } else if (character !== character.toLowerCase()) {
      // Marked rather than folded, so that `A` and `a` can live in one folder
      // on a disk that thinks they are the same name.
      stem += `${character}_`;
    } else {
      stem += character;
    }
  }

  // Each dot-separated part, because `a.con` is as reserved as `con` is on the
  // system that cares.
  stem = stem
    .split(".")
    .map((part) => (RESERVED.has(part.toLowerCase()) ? `_${part}` : part))
    .join(".");

  if (stem === "") stem = "_";
  stem = stem.slice(0, 250);

  let candidate = `${stem}.glif`;
  let count = 1;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${stem}.${String(count).padStart(15, "0")}.glif`;
    count += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Kept for the writer, which needs to escape a name into a comment now and then. */
export { escapeXml };
