/**
 * Composite glyphs: letters built by reference rather than by redrawing.
 *
 * `á` is not a drawing. It is `a` with `acute` placed above it, and that
 * matters more than it sounds: a professional Latin character set runs to
 * several hundred glyphs, most of them accented, and if each were its own
 * drawing then correcting the `a` would mean correcting it thirty more times.
 *
 * TrueType stores this natively as a composite glyph. opentype.js flattens
 * composites into plain outlines when it reads a font, so the structure has to
 * be recovered from the `glyf` table directly or it is lost on import.
 */

import { splitGlyf } from "./glyf";
import type { Component, Contour, Glyph, Typeface, Vec2 } from "./types";

// Composite record flags, from the OpenType specification.
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

/** F2Dot14: a signed fixed-point number with 14 bits of fraction. */
const readF2Dot14 = (view: DataView, offset: number): number => view.getInt16(offset) / 16384;

export interface ReadCompositesResult {
  /** Components per glyph index; absent for glyphs that are not composites. */
  components: Map<number, Component[]>;
  /** Components that referenced a glyph by point matching, which is not modelled. */
  pointMatched: number;
}

/**
 * Recover component structure from a font's `glyf` table.
 *
 * `glyphNames` maps glyph index to name, since components refer to each other
 * by index in the file but by name in the document.
 */
export function readComposites(
  glyf: Uint8Array,
  loca: Uint8Array,
  indexToLocFormat: number,
  numGlyphs: number,
  glyphNames: string[],
): ReadCompositesResult {
  const records = splitGlyf(glyf, loca, indexToLocFormat, numGlyphs);
  const components = new Map<number, Component[]>();
  let pointMatched = 0;

  records.forEach((record, glyphIndex) => {
    if (record.length < 10) return;
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (view.getInt16(0) !== -1) return; // only composites are negative

    const list: Component[] = [];
    let offset = 10; // past numberOfContours and the bounding box
    let flags = 0;

    do {
      if (offset + 4 > record.length) break;
      flags = view.getUint16(offset);
      const referencedIndex = view.getUint16(offset + 2);
      offset += 4;

      let dx = 0;
      let dy = 0;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = view.getInt16(offset);
          dy = view.getInt16(offset + 2);
        } else {
          pointMatched++;
        }
        offset += 4;
      } else {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = view.getInt8(offset);
          dy = view.getInt8(offset + 1);
        } else {
          pointMatched++;
        }
        offset += 2;
      }

      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & WE_HAVE_A_SCALE) {
        a = d = readF2Dot14(view, offset);
        offset += 2;
      } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        a = readF2Dot14(view, offset);
        d = readF2Dot14(view, offset + 2);
        offset += 4;
      } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
        a = readF2Dot14(view, offset);
        b = readF2Dot14(view, offset + 2);
        c = readF2Dot14(view, offset + 4);
        d = readF2Dot14(view, offset + 6);
        offset += 8;
      }

      const name = glyphNames[referencedIndex];
      if (name) list.push({ glyphName: name, transform: { a, b, c, d, dx, dy } });
    } while (flags & MORE_COMPONENTS);

    if (list.length > 0) components.set(glyphIndex, list);
  });

  return { components, pointMatched };
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/** Nesting deeper than this is a cycle or a mistake, not a design. */
const MAX_COMPONENT_DEPTH = 8;

export function applyTransform(point: Vec2, transform: Component["transform"]): Vec2 {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.dx,
    y: transform.b * point.x + transform.d * point.y + transform.dy,
  };
}

function transformContour(contour: Contour, transform: Component["transform"]): Contour {
  return {
    closed: contour.closed,
    nodes: contour.nodes.map((node) => ({
      point: applyTransform(node.point, transform),
      handleIn: node.handleIn ? applyTransform(node.handleIn, transform) : null,
      handleOut: node.handleOut ? applyTransform(node.handleOut, transform) : null,
      type: node.type,
    })),
  };
}

/**
 * The full outline of a glyph: what it draws itself, plus everything its
 * components contribute.
 *
 * A component may itself be a composite, so this recurses. A glyph that ends up
 * referring to itself would recurse forever, so the chain is both depth-capped
 * and cycle-checked; a bad reference is dropped rather than allowed to hang the
 * editor.
 */
export function resolveComponents(
  glyph: Glyph,
  typeface: Typeface,
  visited: ReadonlySet<string> = new Set(),
  depth = 0,
): Contour[] {
  if (glyph.components.length === 0) return glyph.contours;
  if (depth >= MAX_COMPONENT_DEPTH) return glyph.contours;

  const chain = new Set(visited).add(glyph.name);
  const contours = [...glyph.contours];

  for (const component of glyph.components) {
    if (chain.has(component.glyphName)) continue; // would loop back on itself
    const index = typeface.glyphIndex.get(component.glyphName);
    if (index === undefined) continue;

    const referenced = typeface.glyphs[index];
    const inner = resolveComponents(referenced, typeface, chain, depth + 1);
    for (const contour of inner) contours.push(transformContour(contour, component.transform));
  }
  return contours;
}

/** Whether a glyph draws nothing itself and exists only as an arrangement of others. */
export const isPureComposite = (glyph: Glyph): boolean =>
  glyph.components.length > 0 && glyph.contours.length === 0;

/** Every glyph that refers to `name`, so an edit can be reflected in them. */
export function dependentsOf(typeface: Typeface, name: string): string[] {
  return typeface.glyphs
    .filter((glyph) => glyph.components.some((component) => component.glyphName === name))
    .map((glyph) => glyph.name);
}

/**
 * Whether one letter is built out of another, however far down.
 *
 * For refusing a component that would refer back to its own letter. A direct
 * loop is easy to see; the one worth checking for is `á` built from `a`, `a`
 * given `acute`, and `acute` then given `á` -- three reasonable-looking steps
 * making a drawing with no bottom to it, which every renderer that meets one
 * either gives up on or hangs in.
 *
 * The walk is bounded by the glyphs it has already seen rather than by a
 * depth, because a font that already contains a loop must not send the check
 * for one round it for ever.
 */
export function buildsOn(typeface: Typeface, glyphName: string, on: string): boolean {
  const seen = new Set<string>();
  const waiting = [glyphName];
  while (waiting.length > 0) {
    const name = waiting.pop()!;
    if (name === on) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) continue;
    for (const component of typeface.glyphs[index].components) {
      waiting.push(component.glyphName);
    }
  }
  return false;
}
