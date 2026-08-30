/**
 * The operations on one or two points.
 *
 * The transform palette above moves what is drawn. This changes what a point
 * *is*: whether the curve runs smoothly through it, whether it sits on the
 * grid, whether it needs to be there at all. They are separate panels because
 * they answer different questions -- "where should this go" against "what
 * should this be" -- and because the transforms all work on the whole letter
 * when nothing is picked, while most of these need to be told which point.
 *
 * Named for what Glyphs calls them, on the theory that somebody arriving from
 * there has these in their fingers already and nothing is gained by inventing
 * new words for the same operations.
 */

import * as React from "react";

import { tidyWouldRemove } from "@/font/nodes";
import { store, useAppState } from "@/state/useStore";
import { ToolButton } from "@/components/ToolButton";

export function PointsPanel(): React.JSX.Element | null {
  const state = useAppState();
  const glyph = state.selectedGlyph ? store.glyph(state.selectedGlyph) : null;
  if (!glyph || glyph.contours.length === 0) return null;
  const name = glyph.name;

  const picked = state.selectedNodes.size;
  const spare = tidyWouldRemove(glyph.contours);

  return (
    <section className="border-b border-border p-3" data-points-panel>
      <div className="flex items-baseline justify-between pb-2">
        <h3 className="text-2xs font-medium">Points</h3>
        <span className="text-2xs text-muted-foreground" data-points-scope>
          {picked === 0 ? "none picked" : `${picked} point${picked === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 pb-2">
        <ToolButton
          onClick={() => store.retypeSelection(name, "smooth")}
          disabled={picked === 0}
          title={
            picked === 0
              ? "Pick the points to smooth first"
              : "Line the two handles up through the point so the curve passes without a kink. The longer handle stays where it is and the shorter swings round to face it."
          }
        >
          Smooth
        </ToolButton>
        <ToolButton
          onClick={() => store.retypeSelection(name, "corner")}
          disabled={picked === 0}
          title={
            picked === 0
              ? "Pick the points to unsmooth first"
              : "Let the outline turn at these points again. Nothing moves; the handles are simply free of each other."
          }
        >
          Corner
        </ToolButton>
        <ToolButton
          onClick={() => store.roundSelection(name)}
          title={
            picked === 0
              ? "Put every point and handle in the letter on whole units"
              : "Put the picked points and their handles on whole units"
          }
        >
          Round
        </ToolButton>
      </div>

      {/*
        Tidy says its count on the button rather than in the hover, because it
        is the only one here that removes something and a number is the whole
        of what somebody wants to know before pressing it.
      */}
      <div className="flex flex-wrap gap-1 pb-2">
        <ToolButton
          onClick={() => store.tidyGlyph(name)}
          disabled={spare === 0}
          wide
          title={
            spare === 0
              ? "Nothing to tidy up: no doubled points, and nothing a hair off the straight"
              : "Take out points that sit on their neighbour or in the middle of a straight run, and stand up handles that are a fraction off upright. No point that carries a handle is removed."
          }
        >
          {spare === 0 ? "Nothing to tidy" : `Tidy up (${spare})`}
        </ToolButton>
      </div>

      {/*
        The corner pair, which looks strangest to anybody who has not drawn
        type and exists for one job: where a stem meets a shoulder the inside
        angle is sharp, and a sharp inside angle is where ink pools and the
        rasteriser puts a black pixel at small sizes. Opening it gives the join
        a width somebody can decide on.
      */}
      <div className="flex flex-wrap gap-1">
        <ToolButton
          onClick={() => store.openSelectedCorner(name)}
          disabled={picked !== 1}
          title={
            picked === 1
              ? "Replace this corner with two points and a short flat between them, so the join has a width you can set"
              : "Pick the one corner to open"
          }
        >
          Open corner
        </ToolButton>
        <ToolButton
          onClick={() => store.reconnectSelection(name)}
          disabled={picked !== 2}
          title={
            picked === 2
              ? "Carry the two outer sides on until they meet, and put a single corner back where they cross"
              : "Pick the two neighbouring points to join"
          }
        >
          Reconnect
        </ToolButton>
      </div>
    </section>
  );
}
