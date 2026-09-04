/**
 * The three changes to a glyph that the canvas makes directly.
 *
 * Everything else the editor does goes through the store, which records an
 * undo step. These three are handed a glyph that the store has already cloned
 * for that purpose, so they change it in place and say nothing.
 *
 * It sits beside glyph-canvas.ts rather than under it. Neither calls the
 * other.
 */

import { classifyNodes } from "@/font/quadratic";
import type { Glyph, GlyphNode, Vec2 } from "@/font/types";
import { toFontX, toFontY, type GlyphView } from "@/components/glyph-render";
import { store } from "@/state/useStore";

/** How close a click has to land, in screen pixels, to grab a node. */
import { openOutline, parseNodeKey } from "./glyph-pointer";

/** Swing the opposite handle so a smooth node stays smooth. */
export function mirrorHandle(node: GlyphNode, moved: "in" | "out"): void {
  const source = moved === "out" ? node.handleOut : node.handleIn;
  const otherKey = moved === "out" ? "handleIn" : "handleOut";
  const other = node[otherKey];
  if (!source || !other) return;
  const dx = source.x - node.point.x;
  const dy = source.y - node.point.y;
  const sourceLength = Math.hypot(dx, dy);
  if (sourceLength < 1e-6) return;
  // Keep the other handle's own length, only realign its direction.
  const otherLength = Math.hypot(other.x - node.point.x, other.y - node.point.y);
  node[otherKey] = {
    x: node.point.x - (dx / sourceLength) * otherLength,
    y: node.point.y - (dy / sourceLength) * otherLength,
  };
}

/** Pen tool: append a point to the last contour, or start a new one. */
export function addPoint(glyph: Glyph, view: GlyphView, canvasPoint: Vec2): void {
  const point = { x: toFontX(view, canvasPoint.x), y: toFontY(view, canvasPoint.y) };
  const carryOn = openOutline(glyph) !== null;
  store.startDrawing();
  store.editGlyph(glyph.name, "Add point", (editing) => {
    const contour = carryOn ? editing.contours[editing.contours.length - 1] : null;
    const node: GlyphNode = { point, handleIn: null, handleOut: null, type: "corner" };
    if (!contour || contour.closed) {
      editing.contours.push({ nodes: [node], closed: false });
    } else {
      contour.nodes.push(node);
      classifyNodes(contour.nodes);
    }
  });
}

export function deleteSelectedNodes(glyph: Glyph, selected: ReadonlySet<string>): void {
  /*
   * Re-fitting rather than dropping.
   *
   * Removing the nodes and leaving the rest alone is what this did, and the
   * shape jumps: the two segments each point joined become one straight line
   * between their far ends. Every editor a type designer has used re-fits, so
   * losing a point costs a little accuracy rather than the whole curve -- which
   * is the difference between an outline you can thin out and one you cannot.
   */
  store.removePoints(glyph.name, [...selected].map(parseNodeKey));
}
