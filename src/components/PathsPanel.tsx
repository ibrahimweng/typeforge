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

/** One of the operations under the list, all of which look and behave alike. */
function Operation({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

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

  /*
   * The paths whose points are all selected, in the order they were picked up.
   *
   * Which is what the two boolean operations need and what the canvas already
   * says: a path is "picked" when every one of its points is, so clicking a
   * row and shift-clicking another is a way of naming two shapes without a
   * second kind of selection to keep in step with the first.
   */
  const picked = contours
    .map((_, index) => index)
    .filter((index) =>
      contours[index].nodes.every((_, node) =>
        state.selectedNodes.has(nodeKey({ contour: index, node })),
      ),
    );

  const selectWhole = (index: number, add: boolean) => {
    const contour = contours[index];
    if (!contour) return;
    const keys = contour.nodes.map((_, node) => nodeKey({ contour: index, node }));
    store.setSelectedNodes(add ? new Set([...state.selectedNodes, ...keys]) : new Set(keys));
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
                  onClick={(event) => selectWhole(index, event.shiftKey)}
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

      {/*
        The operations, under the paths they operate on.

        All four have been in this application since the exporter needed them,
        and all four ran once, silently, on the way to a file. There was no way
        to ask for any of them while drawing -- so the Checks view could say
        that a letter's extremes were missing and offer nothing to do about it
        but place the points by hand.

        Here rather than in the toolbar because this is the panel about a
        letter's paths, and because the two that need a choice of paths need
        this list to make it in.
      */}
      {/*
        Carrying a drawing to another letter, outside the block below because
        that one waits for the letter to have paths and this must not: an empty
        letter is exactly where a copied one is going.

        On the keyboard as well, where anybody would reach for it first. These
        are here because a keystroke with no button is a feature only the
        person who wrote it knows about.
      */}
      <div className="flex flex-wrap gap-1 pt-2.5" data-carry-actions>
        <Operation
          onClick={() => store.copyOutlines(name)}
          title="Copy the picked paths, or the whole letter when none are picked, ready to put into another letter (⌘C)"
        >
          Copy
        </Operation>
        <Operation
          onClick={() => store.pasteOutlines(name)}
          title="Add the copied paths to this letter, alongside what is already here (⌘V)"
        >
          Paste
        </Operation>
      </div>

      {contours.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-2.5" data-path-actions>
          <Operation
            onClick={() => store.addExtremes(name)}
            title="Put a point wherever a curve reaches its furthest up, down, left or right. Both outline formats want them, and export adds them anyway; doing it here is doing it where you can see it."
          >
            Add extremes
          </Operation>
          <Operation
            onClick={() => store.correctPathDirection(name)}
            title="Wind the paths the way the rest of this font is wound, so counters cut holes rather than filling in."
          >
            Correct direction
          </Operation>
          {contours.length > 1 && (
            <Operation
              onClick={() => void store.removeOverlap(name)}
              title="Fuse the paths into the single outline they add up to. Drawing a letter as overlapping pieces is normal; a font file cannot carry them."
            >
              Remove overlap
            </Operation>
          )}
          {picked.length > 1 && (
            <>
              <Operation
                onClick={() => void store.combineContours(name, picked, "unite")}
                title={`Add path ${picked.map((one) => one + 1).join(" and ")} together into one`}
              >
                Unite {picked.length}
              </Operation>
              <Operation
                onClick={() => void store.combineContours(name, picked, "subtract")}
                title={`Cut path ${picked.slice(1).map((one) => one + 1).join(" and ")} out of path ${picked[0] + 1}`}
              >
                Subtract
              </Operation>
            </>
          )}
        </div>
      )}

      {/*
        About the list above, so it goes when the list does. On a letter with
        nothing in it this was a paragraph on how the order of paths and the
        direction they run decide what fills -- said over no paths at all.
      */}
      {contours.length > 0 && (
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          Which way a path runs decides whether it fills or cuts a hole through the one around it.
          The order is the order the exported file lists them in.
          {contours.length > 1 && picked.length < 2 && (
            <> Shift-click a second path to add or subtract them.</>
          )}
        </p>
      )}
    </section>
  );
}
