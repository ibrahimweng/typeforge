/**
 * The contours a letter is made of, as a list.
 *
 * Nothing showed them. A glyph was a canvas with points on it, and the points
 * were all you could reach: which contour a point belonged to, how many there
 * were, which way round each one ran and what order they came in were facts
 * about the letter that the letter did not say.
 *
 * Two of those are correctness rather than convenience. Direction decides
 * whether a contour fills or cuts a hole in the one around it, so a counter
 * drawn the same way round as its bowl fills solid -- and the only way to find
 * that out was to export the font and look at it somewhere else. Order is what
 * an exported file lists them in, so two fonts that look identical and differ
 * here are two different files.
 *
 * Kept small on purpose. This is a list with three verbs, not a layers system:
 * there is nothing here to name, nothing to hide, and nothing to group, because
 * a glyph's contours are not those things.
 */

import * as React from "react";

import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import { nodeKey, store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/**
 * Which way round a contour runs, in the words the format uses.
 *
 * Signed area is negative for a clockwise contour in font coordinates, and
 * TrueType wants its outer contours clockwise. Said as the direction rather
 * than as "outer" or "hole", because which of those a contour *is* depends on
 * what it sits inside, and this list is not the place to work that out.
 */
const windingOf = (contour: Contour): "clockwise" | "anticlockwise" =>
  contourArea(contour) < 0 ? "clockwise" : "anticlockwise";

export function PathsPanel(): React.JSX.Element | null {
  const state = useAppState();
  const glyph = state.selectedGlyph ? store.glyph(state.selectedGlyph) : null;
  if (!glyph) return null;

  const name = glyph.name;
  const contours = glyph.contours;

  /** Which contours have a point selected, so the list agrees with the canvas. */
  const touched = new Set<number>();
  for (const key of state.selectedNodes) {
    const contour = Number(key.split(":")[0]);
    if (Number.isFinite(contour)) touched.add(contour);
  }

  const selectWhole = (index: number) => {
    const contour = contours[index];
    if (!contour) return;
    store.setSelectedNodes(
      new Set(contour.nodes.map((_, node) => nodeKey({ contour: index, node }))),
    );
  };

  return (
    <section className="border-b border-border p-3" data-paths-panel>
      <div className="flex items-baseline justify-between pb-2">
        <h3 className="text-2xs font-medium">Paths</h3>
        <span className="text-2xs tabular-nums text-muted-foreground">
          {contours.length} {contours.length === 1 ? "path" : "paths"}
        </span>
      </div>

      {contours.length === 0 ? (
        <p className="text-2xs leading-snug text-muted-foreground">
          This letter has no outlines of its own. It may be built from components, which the Build
          tab lists.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {contours.map((contour, index) => {
            const box = contoursBounds([contour]);
            const winding = windingOf(contour);
            const on = touched.has(index);
            return (
              <li
                key={index}
                data-path-row={index}
                className={cn(
                  "flex items-center gap-1.5 rounded px-1.5 py-1 text-2xs transition-colors",
                  on ? "bg-card text-foreground" : "text-muted-foreground hover:bg-card",
                )}
              >
                <button
                  type="button"
                  onClick={() => selectWhole(index)}
                  aria-label={`Select path ${index + 1}`}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  {/*
                    What goes first when the panel is narrow, and what does
                    not.

                    All three of these used to be the wrong way round: the
                    point count was the one marked as truncatable and the
                    other two were held at full size, so in a two-hundred-pixel
                    panel the count vanished entirely, the size ran out past
                    the end of the button and collided with the arrow beside
                    it. The order of the three is an order of importance --
                    how many points, which way round, how big -- so it is the
                    size that gives way. Below the width where it fits it is
                    not there at all: a truncated `1368x1493` reads as `1`,
                    which is not a smaller version of the number, it is a
                    different and wrong one. The truncation stays underneath as
                    the guard against a font whose numbers are longer than
                    these.
                  */}
                  <span className="shrink-0 tabular-nums">{index + 1}</span>
                  <span className="shrink-0">
                    {contour.nodes.length} {contour.nodes.length === 1 ? "point" : "points"}
                  </span>
                  {/*
                    The direction, spelled out rather than shown as an arrow.
                    Somebody debugging a counter that filled solid needs to
                    compare two of these, and two words compare where two
                    glyphs do not.
                  */}
                  <span className="shrink-0 opacity-70">{winding === "clockwise" ? "cw" : "ccw"}</span>
                  {Number.isFinite(box.xMin) && (
                    <span className="hidden min-w-0 truncate tabular-nums opacity-50 xl:inline">
                      {Math.round(box.xMax - box.xMin)}×{Math.round(box.yMax - box.yMin)}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => store.moveContour(name, index, -1)}
                  disabled={index === 0}
                  aria-label={`Move path ${index + 1} earlier`}
                  className="rounded px-1 hover:text-foreground disabled:opacity-25"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => store.moveContour(name, index, 1)}
                  disabled={index === contours.length - 1}
                  aria-label={`Move path ${index + 1} later`}
                  className="rounded px-1 hover:text-foreground disabled:opacity-25"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => store.reverseContour(name, index)}
                  aria-label={`Reverse path ${index + 1}`}
                  title="Turn this path the other way round"
                  className="rounded px-1 hover:text-foreground"
                >
                  ⇄
                </button>
                <button
                  type="button"
                  onClick={() => store.removeContour(name, index)}
                  aria-label={`Delete path ${index + 1}`}
                  className="rounded px-1 hover:text-destructive"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <p className="pt-2 text-2xs leading-snug text-muted-foreground">
        Which way a path runs decides whether it fills or cuts a hole through the one around it.
        The order is the order the exported file lists them in.
      </p>
    </section>
  );
}
