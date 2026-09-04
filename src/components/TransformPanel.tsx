/**
 * Moving what is drawn: mirror, scale, rotate, slant, align.
 *
 * The operations every drawing tool has, and the reason they are worth having
 * in a type editor specifically is that letters are full of repeats. A `b` is
 * a `d` mirrored, a `u` is an `n` turned over, an oblique is the roman leaned
 * twelve degrees. Doing any of that by dragging points is doing arithmetic by
 * hand.
 *
 * Everything here acts on the selection, and on the whole letter when there is
 * no selection -- which is what every other drawing tool does and what somebody
 * who has just opened a glyph and pressed mirror expects. The one exception is
 * aligning, which needs at least two points to line up with each other and says
 * so rather than quietly doing nothing.
 *
 * Kept to buttons and two number fields. A transform palette can grow into a
 * dialog with an origin picker and a lock ratio and a preview, and none of that
 * is what somebody flipping a `b` into a `d` needs.
 */

import * as React from "react";

import { mirror, rotated, scaled, slanted, type Edge } from "@/font/reshape";
import { store, useAppState } from "@/state/useStore";
import { NumberField } from "@/components/NumberField";
import { ToolButton } from "@/components/ToolButton";

export function TransformPanel(): React.JSX.Element | null {
  const state = useAppState();
  const glyph = state.selectedGlyph ? store.glyph(state.selectedGlyph) : null;
  const [turn, setTurn] = React.useState(90);
  const [lean, setLean] = React.useState(12);

  if (!glyph || glyph.contours.length === 0) return null;
  const name = glyph.name;

  const picked = state.selectedNodes.size;
  const scope = picked === 0 ? "the whole letter" : `${picked} point${picked === 1 ? "" : "s"}`;
  const canAlign = picked > 1;

  return (
    <section className="border-b border-border p-3" data-transform-panel>
      <div className="flex items-baseline justify-between pb-2">
        <h3 className="text-2xs font-medium">Transform</h3>
        <span className="text-2xs text-muted-foreground" data-transform-scope>
          {scope}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 pb-2">
        <ToolButton
          onClick={() =>
            store.reshapeGlyph(name, "Mirror horizontally", (centre) =>
              mirror("horizontal", centre),
            )
          }
          title="Flip left to right, about the middle of what is selected. A b is a d mirrored."
        >
          Flip ↔
        </ToolButton>
        <ToolButton
          onClick={() =>
            store.reshapeGlyph(name, "Mirror vertically", (centre) => mirror("vertical", centre))
          }
          title="Flip top to bottom, about the middle of what is selected. A u is an n flipped."
        >
          Flip ↕
        </ToolButton>
        <ToolButton
          onClick={() => store.reshapeGlyph(name, "Rotate", (centre) => rotated(turn, centre))}
          title={`Turn ${turn} degrees anticlockwise about the middle of what is selected`}
        >
          Rotate
        </ToolButton>
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className="w-14 shrink-0 text-2xs text-muted-foreground">Angle</span>
        <NumberField label="Rotation in degrees" className="w-16" value={turn} onCommit={setTurn} />
        <span className="text-2xs text-muted-foreground">°</span>
      </div>

      {/*
        Slant, with its own field, because it is the one here a type designer
        reaches for by a specific number rather than by eye. An oblique is the
        roman leaned over between eight and sixteen degrees, and twelve is the
        middle of that.
      */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <span className="w-14 shrink-0 text-2xs text-muted-foreground">Slant</span>
        <NumberField label="Slant in degrees" className="w-16" value={lean} onCommit={setLean} />
        <ToolButton
          onClick={() => store.reshapeGlyph(name, "Slant", () => slanted(lean))}
          title={`Lean ${lean} degrees off the baseline, so the feet stay on the line and everything above moves. This is how an oblique is made.`}
        >
          Lean
        </ToolButton>
        <ToolButton
          onClick={() => store.reshapeGlyph(name, "Slant", () => slanted(-lean))}
          title={`Lean ${lean} degrees the other way`}
        >
          Back
        </ToolButton>
      </div>

      <div className="flex flex-wrap gap-1 pb-2">
        <ToolButton
          onClick={() =>
            store.reshapeGlyph(name, "Scale up", (centre) => scaled(1.02, 1.02, centre))
          }
          title="Two per cent larger, about the middle of what is selected"
        >
          Bigger
        </ToolButton>
        <ToolButton
          onClick={() =>
            store.reshapeGlyph(name, "Scale down", (centre) => scaled(1 / 1.02, 1 / 1.02, centre))
          }
          title="Two per cent smaller, about the middle of what is selected"
        >
          Smaller
        </ToolButton>
        <ToolButton
          onClick={() => store.reshapeGlyph(name, "Widen", (centre) => scaled(1.02, 1, centre))}
          title="Two per cent wider, and no taller"
        >
          Wider
        </ToolButton>
        <ToolButton
          onClick={() =>
            store.reshapeGlyph(name, "Narrow", (centre) => scaled(1 / 1.02, 1, centre))
          }
          title="Two per cent narrower, and no shorter"
        >
          Narrower
        </ToolButton>
      </div>

      {/*
        Aligning is not a transform and is not offered as one.

        Every button above applies one movement to everything selected. This
        sends each point somewhere different -- to the edge of what is
        selected -- which is what makes it the operation for levelling the two
        feet of an `n` against each other, and why it needs two points before
        it means anything.
      */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-14 shrink-0 text-2xs text-muted-foreground">Align</span>
        {(
          [
            ["left", "⇤", "Move each selected point to the leftmost of them"],
            ["centreX", "↔", "Centre the selected points on each other, side to side"],
            ["right", "⇥", "Move each selected point to the rightmost of them"],
            ["top", "⇧", "Move each selected point to the highest of them"],
            ["centreY", "↕", "Centre the selected points on each other, top to bottom"],
            ["bottom", "⇩", "Move each selected point to the lowest of them"],
          ] as Array<[Edge, string, string]>
        ).map(([edge, glyphChar, hint]) => (
          <ToolButton
            key={edge}
            onClick={() => store.alignSelection(name, edge)}
            disabled={!canAlign}
            title={canAlign ? hint : "Select two or more points to line them up with each other"}
          >
            {glyphChar}
          </ToolButton>
        ))}
      </div>
    </section>
  );
}
