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

import type { Glyph } from "@/font/types";
import { tidyWouldRemove } from "@/font/nodes";
import { KEEPS_THE_SHAPE, simplifyWouldRemove } from "@/font/pen";
import { store, useAppState } from "@/state/useStore";
import { ToolButton } from "@/components/ToolButton";
import { cn } from "@/ui/lib/utils";

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

      {/*
        Picking, above the operations that need something picked.

        A marquee and a click were the whole of what this had, which works up to
        about a dozen points and stops on an imported outline of two hundred.
        `Corners` is the one that earns its place: "make every corner smooth" is
        one press once they are picked, and picking forty of them by hand is why
        nobody does it.
      */}
      <div className="flex flex-wrap items-center gap-1 pb-2" data-select-row>
        {/*
          The row says what it is for, so the buttons in it need not.

          Without the word `Pick` this row read as four more operations, and
          `Smooths` sat directly above `Smooth` doing something else entirely.
          One label on the row is cheaper than four longer buttons, and the
          accessible names below carry the whole sentence for anything reading
          rather than looking.
        */}
        <span className="pr-1 text-2xs text-muted-foreground">Pick</span>
        <ToolButton
          onClick={() => store.selectAllNodes(name)}
          named="Pick every point"
          title="Pick every point in the letter. Also ctrl-A, or command-A."
        >
          All
        </ToolButton>
        <ToolButton
          onClick={() => store.selectNodesOfKind(name, "corner")}
          named="Pick every corner"
          title="Pick every point the outline actually turns at, wherever they are — asking the handles rather than the label the file carries"
        >
          Corners
        </ToolButton>
        <ToolButton
          onClick={() => store.selectNodesOfKind(name, "smooth")}
          named="Pick every smooth point"
          title="Pick every point the curve runs smoothly through"
        >
          Smooths
        </ToolButton>
        <ToolButton
          onClick={() => store.setSelectedNodes([])}
          disabled={picked === 0}
          named="Pick nothing"
          title="Pick nothing, so the operations below work on the whole letter again"
        >
          None
        </ToolButton>
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

      <SimplifyRow contours={glyph.contours} name={name} />

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

/*
 * Simplify, which is the one operation here that trades accuracy for points.
 *
 * Separate from `Tidy up` because they answer different questions and mixing
 * them would hide that: tidy removes points that carry nothing, and is free;
 * simplify asks how few points describe the same run *within a tolerance*, and
 * always costs something. So the tolerance is on the panel rather than buried
 * in a preference -- a person about to redraw their outline should be able to
 * see, and change, how far it is allowed to move.
 *
 * The three strengths are in font units, which is the number a type designer
 * already thinks in. One unit on a thousand-unit em is under a thousandth of
 * the letter and cannot be seen at any size; four is the working figure and is
 * a hair; twelve visibly redraws a curve and is there for an imported or traced
 * outline where the points came from a machine rather than a hand.
 */
const STRENGTHS: { label: string; tolerance: number; says: string }[] = [
  { label: "Close", tolerance: 1, says: "within a unit" },
  { label: "Even", tolerance: KEEPS_THE_SHAPE, says: `within ${KEEPS_THE_SHAPE} units` },
  { label: "Far", tolerance: 12, says: "within 12 units" },
];

function SimplifyRow({
  contours,
  name,
}: {
  contours: Glyph["contours"];
  name: string;
}): React.JSX.Element {
  const [tolerance, setTolerance] = React.useState(KEEPS_THE_SHAPE);

  /*
   * Counted behind a memo because counting means running the whole fit, and a
   * panel that re-fits every contour on every render of every unrelated change
   * is a panel that makes the canvas stutter.
   */
  const saved = React.useMemo(
    () => simplifyWouldRemove(contours, tolerance),
    [contours, tolerance],
  );
  const total = contours.reduce((sum, one) => sum + one.nodes.length, 0);

  return (
    <div className="pb-2" data-simplify>
      <div className="flex gap-1 pb-1">
        {STRENGTHS.map((one) => (
          <button
            key={one.label}
            type="button"
            data-strength={one.label}
            aria-pressed={tolerance === one.tolerance}
            onClick={() => setTolerance(one.tolerance)}
            title={`Let the outline move ${one.says} of where it is now`}
            className={cn(
              "flex-1 rounded border px-1.5 py-1 text-2xs transition-colors",
              tolerance === one.tolerance
                ? "border-accent bg-accent/10 text-foreground"
                : "border-border text-muted-foreground hover:border-accent hover:text-foreground",
            )}
          >
            {one.label}
          </button>
        ))}
      </div>
      <ToolButton
        onClick={() => store.simplifyGlyph(name, tolerance)}
        disabled={saved === 0}
        wide
        title={
          saved === 0
            ? "Nothing to take out at this tolerance: these points are all carrying the shape"
            : `Redraw all ${total} points as ${total - saved}, letting the outline move ${STRENGTHS.find((one) => one.tolerance === tolerance)?.says ?? ""} of where it is now`
        }
      >
        {saved === 0 ? "Nothing to simplify" : `Simplify (${total} \u2192 ${total - saved})`}
      </ToolButton>
    </div>
  );
}
