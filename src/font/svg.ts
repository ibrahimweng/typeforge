/**
 * Reading and writing SVG.
 *
 * One letter leaves as a drawing, is worked on in whatever tool the person
 * doing the drawing prefers, and comes back into the slot it left. That is the
 * whole job, and the difficult half is the return: the file that comes back is
 * whatever the other tool decided to write, which is rarely what left.
 *
 * So this parses SVG rather than trusting it. Illustrator writes ellipses as
 * four arcs, Inkscape writes them as an `<ellipse>`, Figma flattens everything
 * to a path and hangs a transform on a group above it, and any of the three
 * may rewrite the viewBox. All of that has to come back as the same outline in
 * font units, and none of it can be assumed.
 *
 * There is deliberately no DOM here. The tests run in node and the browser
 * runs the same code, and an XML parser small enough to read is a better
 * dependency than a difference between the two.
 */

import type { Contour, GlyphNode, Vec2 } from "./types";

// ---------------------------------------------------------------------------
// What a file says about itself
// ---------------------------------------------------------------------------

/**
 * What Typeforge wrote on a glyph it exported.
 *
 * Present when the file came from here and came back unmangled, which is the
 * ordinary case and the one where the letter can go back exactly where it was.
 * Absent when someone drew the file from nothing, and then the outline has to
 * be fitted to the metrics instead of trusted.
 */
export interface SvgNote {
  /** Which letter this is. */
  name: string;
  /** The advance it left with, so it can return to the same rhythm. */
  advanceWidth: number;
  unitsPerEm: number;
  /**
   * The font-unit height sitting at the top edge of the box.
   *
   * The one number that inverts the export. SVG measures y downwards from the
   * top of the viewBox and a font measures it upwards from the baseline, so
   * `y_font = top - y_svg` and nothing else is needed to get back.
   */
  top: number;
}

export interface SvgBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An SVG that has been read, still in the file's own coordinates. */
export interface SvgDrawing {
  contours: Contour[];
  viewBox: SvgBox;
  note: SvgNote | null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** A line to draw across the sheet, so the person editing can see the metrics. */
export interface SvgGuide {
  label: string;
  /** In font units, measured from the baseline. */
  height: number;
}

export interface GlyphSvgOptions {
  name: string;
  contours: Contour[];
  advanceWidth: number;
  unitsPerEm: number;
  /** The top of the sheet, in font units. Usually the ascender. */
  top: number;
  /** The bottom of the sheet, in font units. Usually the descender, so negative. */
  bottom: number;
  /** Horizontal guides: baseline, x-height, cap height and the rest. */
  guides: SvgGuide[];
  /** Where the letter's own space starts and stops, in font units. */
  sidebearings?: { left: number; right: number };
}

/**
 * Write one glyph as an SVG sheet.
 *
 * Drawn in font units rather than scaled to some convenient pixel size,
 * because a coordinate that survives the trip is worth more than a file that
 * opens at a comfortable zoom. Every editor can zoom; none of them can undo a
 * rounding.
 *
 * The guides go in a marked group that the reader ignores, and the ink is
 * marked too. Between the two markings the file survives an editor that keeps
 * one and drops the other, which between them they all do.
 */
export function glyphSvg(options: GlyphSvgOptions): string {
  const { name, contours, advanceWidth, unitsPerEm, top, bottom } = options;
  const height = top - bottom;
  const width = Math.max(advanceWidth, 1);
  const flipped = contours.map((contour) =>
    mapContour(contour, (point) => ({ x: point.x, y: top - point.y })),
  );

  // Thin enough to sit under the outline rather than in front of it, and set
  // as a fraction of the em so it looks the same whatever the units are.
  const hair = Math.max(unitsPerEm / 500, 1);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
      ` width="${round((width / unitsPerEm) * 512)}" height="${round((height / unitsPerEm) * 512)}"` +
      ` viewBox="0 0 ${round(width)} ${round(height)}"` +
      ` data-typeforge="glyph" data-typeforge-version="1"` +
      ` data-typeforge-name="${escapeAttribute(name)}"` +
      ` data-typeforge-advance="${round(advanceWidth)}"` +
      ` data-typeforge-upm="${round(unitsPerEm)}"` +
      ` data-typeforge-top="${round(top)}">`,
  );
  lines.push(`  <title>${escapeText(name)}</title>`);
  lines.push(
    `  <desc>Drawn by Typeforge. Edit the black outline; the grey guides are ignored when this comes back.</desc>`,
  );

  lines.push(
    `  <g id="typeforge-guides" data-typeforge="guides" fill="none" stroke="#c8c8c8" stroke-width="${round(hair)}">`,
  );
  for (const guide of options.guides) {
    const y = round(top - guide.height);
    lines.push(
      `    <line data-typeforge="guide" x1="0" y1="${y}" x2="${round(width)}" y2="${y}"><title>${escapeText(guide.label)}</title></line>`,
    );
  }
  if (options.sidebearings) {
    const { left, right } = options.sidebearings;
    for (const [label, x] of [
      ["left sidebearing", left],
      ["right sidebearing", advanceWidth - right],
    ] as const) {
      lines.push(
        `    <line data-typeforge="guide" x1="${round(x)}" y1="0" x2="${round(x)}" y2="${round(height)}"><title>${escapeText(label)}</title></line>`,
      );
    }
  }
  lines.push(`  </g>`);

  const d = contoursToSvgPathData(flipped);
  lines.push(
    `  <path id="typeforge-ink" data-typeforge="ink" fill="#000000" fill-rule="nonzero" d="${d}"/>`,
  );
  lines.push(`</svg>`);
  return `${lines.join("\n")}\n`;
}

/**
 * Contours as SVG path data.
 *
 * Separate from the one in geometry.ts, which rounds to two places for a
 * preview. A file that is going to be edited and brought back should not lose
 * anything on the way out, so this keeps three.
 */
export function contoursToSvgPathData(contours: Contour[]): string {
  const parts: string[] = [];
  for (const contour of contours) {
    const { nodes } = contour;
    if (nodes.length === 0) continue;
    parts.push(`M${round(nodes[0].point.x)} ${round(nodes[0].point.y)}`);
    const last = contour.closed ? nodes.length : nodes.length - 1;
    for (let index = 0; index < last; index++) {
      const from = nodes[index];
      const to = nodes[(index + 1) % nodes.length];
      if (!from.handleOut && !to.handleIn) {
        parts.push(`L${round(to.point.x)} ${round(to.point.y)}`);
      } else {
        const c1 = from.handleOut ?? from.point;
        const c2 = to.handleIn ?? to.point;
        parts.push(
          `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(to.point.x)} ${round(to.point.y)}`,
        );
      }
    }
    if (contour.closed) parts.push("Z");
  }
  return parts.join("");
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read an SVG document into contours, in the file's own coordinates.
 *
 * Flipping into font units is the caller's business, because there are two
 * ways to do it and only the caller knows which applies: a file with a note on
 * it goes back where it came from, and a file without one has to be fitted.
 */
export function readSvg(text: string): SvgDrawing {
  const root = findRoot(text);
  const viewBox = readViewBox(root?.attributes ?? {});
  const note = readNote(root?.attributes ?? {});
  const shapes = collectShapes(text);

  // Anything outside a guide group is ink. If that leaves nothing -- an editor
  // that dropped the markings, or a file where somebody drew over the guides
  // and deleted the outline -- take the lot rather than hand back an empty
  // letter and call it a successful import.
  const ink = shapes.filter((shape) => !shape.guide);
  const chosen = ink.length > 0 ? ink : shapes;
  return { contours: chosen.flatMap((shape) => shape.contours), viewBox, note };
}

/**
 * Put a drawing back into font units.
 *
 * With a note, this is the exact inverse of the export and the letter lands
 * where it left, whatever the file has been through in between -- an editor
 * that rewrote the viewBox has not moved the ink, and the ink is what the
 * coordinates describe.
 *
 * Without one, the drawing is fitted: scaled so its own height fills the band
 * between the two heights given, and centred in the advance. That is a guess,
 * but it is the guess a person makes by hand and it is the only one available.
 */
export function svgToFontUnits(
  drawing: SvgDrawing,
  fallback: { top: number; bottom: number; advanceWidth: number },
): { contours: Contour[]; advanceWidth: number } {
  if (drawing.note) {
    const { top } = drawing.note;
    return {
      contours: drawing.contours.map((contour) =>
        mapContour(contour, (p) => ({ x: p.x, y: top - p.y })),
      ),
      advanceWidth: drawing.note.advanceWidth,
    };
  }

  const { viewBox } = drawing;
  const height = viewBox.height > 0 ? viewBox.height : 1;
  const scale = (fallback.top - fallback.bottom) / height;
  const top = fallback.top;
  const scaled = drawing.contours.map((contour) =>
    mapContour(contour, (p) => ({
      x: (p.x - viewBox.x) * scale,
      y: top - (p.y - viewBox.y) * scale,
    })),
  );
  return { contours: scaled, advanceWidth: fallback.advanceWidth };
}

function mapContour(contour: Contour, move: (point: Vec2) => Vec2): Contour {
  return {
    closed: contour.closed,
    nodes: contour.nodes.map((node) => ({
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
      type: node.type,
    })),
  };
}

function readViewBox(attributes: Record<string, string>): SvgBox {
  const raw = attributes.viewbox;
  if (raw) {
    const numbers = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (numbers.length === 4 && numbers.every((value) => Number.isFinite(value))) {
      return { x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3] };
    }
  }
  const width = Number(attributes.width?.replace(/[a-z%]+$/i, ""));
  const height = Number(attributes.height?.replace(/[a-z%]+$/i, ""));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height };
  }
  return { x: 0, y: 0, width: 0, height: 0 };
}

function readNote(attributes: Record<string, string>): SvgNote | null {
  if (attributes["data-typeforge"] !== "glyph") return null;
  const name = attributes["data-typeforge-name"];
  const advanceWidth = Number(attributes["data-typeforge-advance"]);
  const unitsPerEm = Number(attributes["data-typeforge-upm"]);
  const top = Number(attributes["data-typeforge-top"]);
  if (!name) return null;
  if (![advanceWidth, unitsPerEm, top].every((value) => Number.isFinite(value))) return null;
  return { name, advanceWidth, unitsPerEm, top };
}

// ---------------------------------------------------------------------------
// The XML walk
// ---------------------------------------------------------------------------

interface Tag {
  name: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
  closing: boolean;
}

interface Shape {
  contours: Contour[];
  guide: boolean;
}

/** Elements whose contents describe something rather than draw it. */
const UNDRAWN = new Set([
  "defs",
  "clippath",
  "mask",
  "symbol",
  "marker",
  "pattern",
  "style",
  "metadata",
  "title",
  "desc",
]);

function findRoot(text: string): Tag | null {
  for (const tag of tags(text)) {
    if (tag.name === "svg" && !tag.closing) return tag;
  }
  return null;
}

/**
 * Walk the document, carrying the transform down.
 *
 * A stack rather than recursion because the input is a token stream and a
 * malformed document -- an unclosed group, a stray close -- should give up the
 * shapes it did contain rather than throw. Anything coming back from another
 * editor deserves that much.
 */
function collectShapes(text: string): Shape[] {
  const shapes: Shape[] = [];
  const stack: Array<{ name: string; matrix: Matrix; guide: boolean; undrawn: boolean }> = [];
  let matrix = IDENTITY;
  let guide = false;
  let undrawn = 0;

  for (const tag of tags(text)) {
    if (tag.closing) {
      const frame = stack.pop();
      if (!frame) continue;
      matrix = frame.matrix;
      guide = frame.guide;
      if (frame.undrawn) undrawn--;
      continue;
    }

    const isUndrawn = UNDRAWN.has(tag.name);
    const marksGuide = isGuide(tag.attributes);
    const own = tag.attributes.transform
      ? multiply(matrix, parseTransform(tag.attributes.transform))
      : matrix;

    if (!tag.selfClosing) {
      stack.push({ name: tag.name, matrix, guide, undrawn: isUndrawn });
      matrix = own;
      guide = guide || marksGuide;
      if (isUndrawn) undrawn++;
      continue;
    }

    if (undrawn > 0 || isUndrawn) continue;
    const contours = shapeContours(tag);
    if (contours.length === 0) continue;
    shapes.push({
      contours: contours.map((contour) => mapContour(contour, (point) => apply(own, point))),
      guide: guide || marksGuide,
    });
  }
  return shapes;
}

function isGuide(attributes: Record<string, string>): boolean {
  const marked = attributes["data-typeforge"];
  if (marked === "guides" || marked === "guide") return true;
  const id = attributes.id;
  return typeof id === "string" && id.startsWith("typeforge-guide");
}

/**
 * Every tag in the document, in order, with the ones that carry no shapes
 * skipped over.
 *
 * Self-closing is reported for real self-closing tags and for the leaf shapes,
 * so a `<path>…</path>` written the long way is treated the same as `<path/>`:
 * a shape, not a container. The only elements this walk needs to nest into are
 * groups and the things that hide their contents.
 */
function* tags(text: string): Generator<Tag> {
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("<", index);
    if (open === -1) return;

    if (text.startsWith("<!--", open)) {
      const end = text.indexOf("-->", open);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const end = text.indexOf("]]>", open);
      index = end === -1 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<?", open) || text.startsWith("<!", open)) {
      const end = text.indexOf(">", open);
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    const end = findTagEnd(text, open);
    if (end === -1) return;
    const inner = text.slice(open + 1, end);
    index = end + 1;

    const closing = inner.startsWith("/");
    const body = closing ? inner.slice(1) : inner;
    const selfClosing = body.trimEnd().endsWith("/");
    const cleaned = selfClosing ? body.trimEnd().slice(0, -1) : body;

    const match = /^\s*([^\s/>]+)/.exec(cleaned);
    if (!match) continue;
    const name = localName(match[1]);
    if (closing) {
      yield { name, attributes: {}, selfClosing: false, closing: true };
      continue;
    }

    const attributes = parseAttributes(cleaned.slice(match[0].length));
    // A shape written with a closing tag is still a shape. Reporting it as
    // self-closing keeps the stack for groups only, and lets the matching
    // `</path>` fall through as a close with nothing to pop -- which it is.
    const leaf = selfClosing || SHAPES.has(name);
    yield { name, attributes, selfClosing: leaf, closing: false };
  }
}

/** Where this tag stops, skipping any `>` sitting inside a quoted value. */
function findTagEnd(text: string, open: number): number {
  let quote = "";
  for (let index = open + 1; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function localName(raw: string): string {
  const colon = raw.lastIndexOf(":");
  return (colon === -1 ? raw : raw.slice(colon + 1)).toLowerCase();
}

function parseAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes[localName(match[1])] = unescapeText(value);
  }
  return attributes;
}

function unescapeText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);

function shapeContours(tag: Tag): Contour[] {
  const a = tag.attributes;
  switch (tag.name) {
    case "path":
      return a.d ? parsePath(a.d) : [];
    case "rect":
      return rectContours(number(a.x), number(a.y), number(a.width), number(a.height), a.rx, a.ry);
    case "circle": {
      const r = number(a.r);
      return r > 0 ? [ellipseContour(number(a.cx), number(a.cy), r, r)] : [];
    }
    case "ellipse": {
      const rx = number(a.rx);
      const ry = number(a.ry);
      return rx > 0 && ry > 0 ? [ellipseContour(number(a.cx), number(a.cy), rx, ry)] : [];
    }
    case "polygon":
      return pointsContour(a.points, true);
    case "polyline":
      return pointsContour(a.points, false);
    case "line":
      return [
        {
          closed: false,
          nodes: [
            corner({ x: number(a.x1), y: number(a.y1) }),
            corner({ x: number(a.x2), y: number(a.y2) }),
          ],
        },
      ];
    default:
      return [];
  }
}

function number(raw: string | undefined): number {
  if (!raw) return 0;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function corner(point: Vec2): GlyphNode {
  return { point, handleIn: null, handleOut: null, type: "corner" };
}

function pointsContour(raw: string | undefined, closed: boolean): Contour[] {
  if (!raw) return [];
  const numbers = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const nodes: GlyphNode[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    nodes.push(corner({ x: numbers[index], y: numbers[index + 1] }));
  }
  return nodes.length >= 2 ? [{ closed, nodes }] : [];
}

function rectContours(
  x: number,
  y: number,
  width: number,
  height: number,
  rxRaw: string | undefined,
  ryRaw: string | undefined,
): Contour[] {
  if (!(width > 0) || !(height > 0)) return [];
  let rx = rxRaw === undefined ? (ryRaw === undefined ? 0 : number(ryRaw)) : number(rxRaw);
  let ry = ryRaw === undefined ? rx : number(ryRaw);
  rx = Math.min(Math.max(rx, 0), width / 2);
  ry = Math.min(Math.max(ry, 0), height / 2);

  if (rx === 0 || ry === 0) {
    return [
      {
        closed: true,
        nodes: [
          corner({ x, y }),
          corner({ x: x + width, y }),
          corner({ x: x + width, y: y + height }),
          corner({ x, y: y + height }),
        ],
      },
    ];
  }

  // The circular-arc constant, which is what every drawing program uses for a
  // rounded corner and what the export writes back out.
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const nodes: GlyphNode[] = [
    { point: { x: x + rx, y }, handleIn: { x: x + rx - kx, y }, handleOut: null, type: "corner" },
    {
      point: { x: x + width - rx, y },
      handleIn: null,
      handleOut: { x: x + width - rx + kx, y },
      type: "corner",
    },
    {
      point: { x: x + width, y: y + ry },
      handleIn: { x: x + width, y: y + ry - ky },
      handleOut: null,
      type: "corner",
    },
    {
      point: { x: x + width, y: y + height - ry },
      handleIn: null,
      handleOut: { x: x + width, y: y + height - ry + ky },
      type: "corner",
    },
    {
      point: { x: x + width - rx, y: y + height },
      handleIn: { x: x + width - rx + kx, y: y + height },
      handleOut: null,
      type: "corner",
    },
    {
      point: { x: x + rx, y: y + height },
      handleIn: null,
      handleOut: { x: x + rx - kx, y: y + height },
      type: "corner",
    },
    {
      point: { x, y: y + height - ry },
      handleIn: { x, y: y + height - ry + ky },
      handleOut: null,
      type: "corner",
    },
    { point: { x, y: y + ry }, handleIn: null, handleOut: { x, y: y + ry - ky }, type: "corner" },
  ];
  return [{ closed: true, nodes }];
}

const KAPPA = 0.5522847498307936;

function ellipseContour(cx: number, cy: number, rx: number, ry: number): Contour {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    nodes: [
      {
        point: { x: cx + rx, y: cy },
        handleIn: { x: cx + rx, y: cy - ky },
        handleOut: { x: cx + rx, y: cy + ky },
        type: "smooth",
      },
      {
        point: { x: cx, y: cy + ry },
        handleIn: { x: cx + kx, y: cy + ry },
        handleOut: { x: cx - kx, y: cy + ry },
        type: "smooth",
      },
      {
        point: { x: cx - rx, y: cy },
        handleIn: { x: cx - rx, y: cy + ky },
        handleOut: { x: cx - rx, y: cy - ky },
        type: "smooth",
      },
      {
        point: { x: cx, y: cy - ry },
        handleIn: { x: cx - kx, y: cy - ry },
        handleOut: { x: cx + kx, y: cy - ry },
        type: "smooth",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Path data
// ---------------------------------------------------------------------------

/**
 * Parse a `d` attribute.
 *
 * Every command, including the arcs and the shorthand curves, because which
 * ones appear is decided by whichever program wrote the file. Inkscape writes
 * arcs for anything round, Illustrator writes cubics, and a file that has been
 * through both contains a mixture.
 */
export function parsePath(d: string): Contour[] {
  const contours: Contour[] = [];
  let nodes: GlyphNode[] = [];
  let closed = false;
  let current: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  // For the shorthand curves, which mirror the previous control point.
  let lastCubic: Vec2 | null = null;
  let lastQuadratic: Vec2 | null = null;

  const flush = () => {
    if (nodes.length >= 2) contours.push(finish(nodes, closed));
    nodes = [];
    closed = false;
  };

  const lineTo = (to: Vec2) => {
    if (nodes.length === 0) nodes.push(corner(current));
    nodes.push(corner(to));
    current = to;
    lastCubic = null;
    lastQuadratic = null;
  };

  /*
   * The control point a shorthand curve implies.
   *
   * Written as a function taking the previous control rather than reading the
   * variable straight, because the variables are set from inside `curveTo` and
   * a reference in the same scope would be read as still holding whatever it
   * last visibly held.
   */
  const mirror = (previous: Vec2 | null): Vec2 =>
    previous ? { x: 2 * current.x - previous.x, y: 2 * current.y - previous.y } : { ...current };

  const curveTo = (c1: Vec2, c2: Vec2, to: Vec2) => {
    if (nodes.length === 0) nodes.push(corner(current));
    nodes[nodes.length - 1].handleOut = c1;
    nodes.push({ point: to, handleIn: c2, handleOut: null, type: "smooth" });
    current = to;
    lastCubic = c2;
    lastQuadratic = null;
  };

  for (const { code, args } of pathCommands(d)) {
    const relative = code === code.toLowerCase();
    const at = (x: number, y: number): Vec2 =>
      relative ? { x: current.x + x, y: current.y + y } : { x, y };

    switch (code.toUpperCase()) {
      case "M": {
        for (let index = 0; index + 1 < args.length; index += 2) {
          const point = at(args[index], args[index + 1]);
          if (index === 0) {
            flush();
            nodes.push(corner(point));
            start = point;
            current = point;
          } else {
            // Every pair after the first is an implicit lineto, which is what
            // the specification says and what every writer relies on.
            lineTo(point);
          }
          current = point;
        }
        lastCubic = null;
        lastQuadratic = null;
        break;
      }
      case "L": {
        for (let index = 0; index + 1 < args.length; index += 2)
          lineTo(at(args[index], args[index + 1]));
        break;
      }
      case "H": {
        for (const x of args)
          lineTo(relative ? { x: current.x + x, y: current.y } : { x, y: current.y });
        break;
      }
      case "V": {
        for (const y of args)
          lineTo(relative ? { x: current.x, y: current.y + y } : { x: current.x, y });
        break;
      }
      case "C": {
        for (let index = 0; index + 5 < args.length; index += 6) {
          curveTo(
            at(args[index], args[index + 1]),
            at(args[index + 2], args[index + 3]),
            at(args[index + 4], args[index + 5]),
          );
        }
        break;
      }
      case "S": {
        for (let index = 0; index + 3 < args.length; index += 4) {
          const c1 = mirror(lastCubic);
          curveTo(c1, at(args[index], args[index + 1]), at(args[index + 2], args[index + 3]));
        }
        break;
      }
      case "Q": {
        for (let index = 0; index + 3 < args.length; index += 4) {
          const control = at(args[index], args[index + 1]);
          const to = at(args[index + 2], args[index + 3]);
          const from = current;
          curveTo(raise(from, control), raise(to, control), to);
          lastQuadratic = control;
        }
        break;
      }
      case "T": {
        for (let index = 0; index + 1 < args.length; index += 2) {
          const control = mirror(lastQuadratic);
          const to = at(args[index], args[index + 1]);
          const from = current;
          curveTo(raise(from, control), raise(to, control), to);
          lastQuadratic = control;
        }
        break;
      }
      case "A": {
        for (let index = 0; index + 6 < args.length; index += 7) {
          const to = relative
            ? { x: current.x + args[index + 5], y: current.y + args[index + 6] }
            : { x: args[index + 5], y: args[index + 6] };
          for (const piece of arcToCubics(
            current,
            args[index],
            args[index + 1],
            args[index + 2],
            args[index + 3] !== 0,
            args[index + 4] !== 0,
            to,
          )) {
            curveTo(piece.c1, piece.c2, piece.to);
          }
          current = to;
        }
        break;
      }
      case "Z": {
        closed = true;
        flush();
        current = start;
        lastCubic = null;
        lastQuadratic = null;
        break;
      }
      default:
        break;
    }
  }
  flush();
  return contours;
}

/** A quadratic control point as the matching cubic one, from one of its ends. */
function raise(end: Vec2, control: Vec2): Vec2 {
  return { x: end.x + (2 / 3) * (control.x - end.x), y: end.y + (2 / 3) * (control.y - end.y) };
}

/**
 * Close a run of nodes into a contour.
 *
 * A closed path usually ends where it started, and the duplicate point has to
 * go: left in, it is a zero-length segment, which every check in this
 * application quite rightly complains about. What it carries -- the handle
 * arriving back at the start -- moves onto the node it duplicates.
 */
function finish(nodes: GlyphNode[], closed: boolean): Contour {
  if (!closed || nodes.length < 3) return { nodes, closed };
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (
    Math.abs(first.point.x - last.point.x) < 1e-6 &&
    Math.abs(first.point.y - last.point.y) < 1e-6
  ) {
    first.handleIn = last.handleIn;
    return { nodes: nodes.slice(0, -1), closed: true };
  }
  return { nodes, closed: true };
}

/** The commands in a `d` attribute, with the arc flags read as flags. */
function* pathCommands(d: string): Generator<{ code: string; args: number[] }> {
  let index = 0;
  const skip = () => {
    while (
      index < d.length &&
      (d[index] === " " ||
        d[index] === "," ||
        d[index] === "\n" ||
        d[index] === "\r" ||
        d[index] === "\t")
    ) {
      index++;
    }
  };
  const readNumber = (): number | null => {
    skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(index));
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  };
  const readFlag = (): number | null => {
    skip();
    const character = d[index];
    if (character === "0" || character === "1") {
      index++;
      return Number(character);
    }
    return readNumber();
  };

  let code = "";
  while (index < d.length) {
    skip();
    if (index >= d.length) break;
    const character = d[index];
    if (/[a-zA-Z]/.test(character)) {
      code = character;
      index++;
    } else if (!code) {
      // A stray number before any command. Nothing sensible to do with it.
      index++;
      continue;
    } else if (code === "M") {
      code = "L";
    } else if (code === "m") {
      code = "l";
    }

    const upper = code.toUpperCase();
    if (upper === "Z") {
      yield { code, args: [] };
      continue;
    }

    const wanted = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[upper];
    if (!wanted) continue;

    const args: number[] = [];
    for (let slot = 0; slot < wanted; slot++) {
      // The two arc flags are single characters and may be written with
      // nothing between them and the number that follows -- `a1 1 0 011 1` is
      // legal and common, and reading it as numbers gives `011` and loses the
      // rest of the path.
      const value = upper === "A" && (slot === 3 || slot === 4) ? readFlag() : readNumber();
      if (value === null) return;
      args.push(value);
    }
    yield { code, args };

    // Repeated argument sets carry the same command, which is how a polygon
    // ends up as one `L` with forty numbers after it.
    const before = index;
    skip();
    if (index < d.length && !/[a-zA-Z]/.test(d[index])) {
      let more: number[] = [];
      let complete = true;
      while (complete) {
        more = [];
        const mark = index;
        for (let slot = 0; slot < wanted; slot++) {
          const value = upper === "A" && (slot === 3 || slot === 4) ? readFlag() : readNumber();
          if (value === null) {
            complete = false;
            index = mark;
            break;
          }
          more.push(value);
        }
        if (!complete) break;
        yield { code: code === "M" ? "L" : code === "m" ? "l" : code, args: more };
        skip();
        if (index >= d.length || /[a-zA-Z]/.test(d[index])) break;
      }
    } else {
      index = before;
    }
  }
}

/**
 * An elliptical arc as cubic pieces.
 *
 * The endpoint parameterisation SVG uses says where the arc finishes rather
 * than where its centre is, so the centre has to be recovered first. The
 * conversion is the one in the SVG specification's implementation notes,
 * including the correction that grows an ellipse too small to reach its own
 * endpoint -- which files in the wild do contain.
 */
function arcToCubics(
  from: Vec2,
  rxRaw: number,
  ryRaw: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  to: Vec2,
): Array<{ c1: Vec2; c2: Vec2; to: Vec2 }> {
  let rx = Math.abs(rxRaw);
  let ry = Math.abs(ryRaw);
  if (rx === 0 || ry === 0) return [{ c1: { ...from }, c2: { ...to }, to }];
  if (Math.abs(from.x - to.x) < 1e-9 && Math.abs(from.y - to.y) < 1e-9) return [];

  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;

  const oversize = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (oversize > 1) {
    const grow = Math.sqrt(oversize);
    rx *= grow;
    ry *= grow;
  }

  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;

  const angleOf = (x: number, y: number) => Math.atan2((y - cy1) / ry, (x - cx1) / rx);
  const startAngle = angleOf(x1, y1);
  let delta = angleOf(-x1, -y1) - startAngle;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  // A quarter turn is where the cubic approximation of a circular arc is good
  // to well under a thousandth of the radius, which in font units is nothing.
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / pieces;
  const handle = (4 / 3) * Math.tan(step / 4);

  const onArc = (angle: number): Vec2 => {
    const x = rx * Math.cos(angle);
    const y = ry * Math.sin(angle);
    return { x: cos * x - sin * y + cx, y: sin * x + cos * y + cy };
  };
  const slope = (angle: number): Vec2 => {
    const x = -rx * Math.sin(angle);
    const y = ry * Math.cos(angle);
    return { x: cos * x - sin * y, y: sin * x + cos * y };
  };

  const out: Array<{ c1: Vec2; c2: Vec2; to: Vec2 }> = [];
  for (let piece = 0; piece < pieces; piece++) {
    const a = startAngle + step * piece;
    const b = a + step;
    const pa = onArc(a);
    const pb = onArc(b);
    const da = slope(a);
    const db = slope(b);
    out.push({
      c1: { x: pa.x + handle * da.x, y: pa.y + handle * da.y },
      c2: { x: pb.x - handle * db.x, y: pb.y - handle * db.y },
      to: pb,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** The six numbers of an SVG transform, in the order SVG writes them. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function apply(matrix: Matrix, point: Vec2): Vec2 {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

export function parseTransform(text: string): Matrix {
  let matrix = IDENTITY;
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const match of text.matchAll(pattern)) {
    const values = match[2]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value));
    matrix = multiply(matrix, single(match[1].toLowerCase(), values));
  }
  return matrix;
}

function single(name: string, v: number[]): Matrix {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  switch (name) {
    case "matrix":
      return v.length >= 6 ? [v[0], v[1], v[2], v[3], v[4], v[5]] : IDENTITY;
    case "translate":
      return [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
    case "scale": {
      const x = v[0] ?? 1;
      return [x, 0, 0, v[1] ?? x, 0, 0];
    }
    case "rotate": {
      const angle = radians(v[0] ?? 0);
      const spin: Matrix = [
        Math.cos(angle),
        Math.sin(angle),
        -Math.sin(angle),
        Math.cos(angle),
        0,
        0,
      ];
      if (v.length < 3) return spin;
      // Rotation about a point, which is a translate either side of the spin.
      return multiply(multiply([1, 0, 0, 1, v[1], v[2]], spin), [1, 0, 0, 1, -v[1], -v[2]]);
    }
    case "skewx":
      return [1, 0, Math.tan(radians(v[0] ?? 0)), 1, 0, 0];
    case "skewy":
      return [1, Math.tan(radians(v[0] ?? 0)), 0, 1, 0, 0];
    default:
      return IDENTITY;
  }
}
