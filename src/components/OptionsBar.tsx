/**
 * The tool in hand, named, with whatever belongs to it.
 *
 * A drawing program puts the settings of the current tool in one strip under
 * the toolbar, and has since Photoshop 6. The reason is not tidiness. A tool's
 * settings are read and changed while you are looking at the canvas, in the
 * middle of the gesture they affect, and a control for one of them in a column
 * on the far side of the window is a control you stop drawing to go and find.
 *
 * Here they were in three different places. The polygon's side count was at
 * the right-hand end of the row of letters, where it appeared and disappeared
 * as the tool changed and was the first thing to be squeezed out on a narrow
 * window. The pen's three numbers were in the Inspector, four hundred pixels
 * from the stroke being written. The switches for how the canvas behaves were
 * sharing a row with the letters standing either side, which are not a setting
 * at all.
 *
 * So this is the one strip. On the left, the tool: its name, what it does, and
 * its own controls. On the right, the switches about the surface it is drawn
 * on. Nothing here is new; every control was somewhere else a moment ago, and
 * every one of them is the same control.
 *
 * It is drawn only while there is a letter open with a tool in hand. An
 * options bar for no tool is an empty strip, and the honest answer to "what is
 * the pen set to" when nobody is holding a pen is to say nothing.
 */

import type * as React from "react";

import { PenNumbers } from "@/components/PenPanel";
import { GroundToggle } from "@/components/GroundToggle";
import { toolInfo, writesStrokes } from "@/font/toolset";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/cn";

const SWITCH =
  "rounded border px-2 py-1 text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

/** A switch that is on or off, drawn the same way wherever it appears here. */
function Toggle({
  on,
  onPress,
  title,
  tint,
  children,
  ...rest
}: {
  on: boolean;
  onPress: () => void;
  title: string;
  /** The colour it takes when it is on, since the faults have their own. */
  tint: "accent" | "attention";
  children: React.ReactNode;
} & React.ComponentProps<"button">): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      title={title}
      className={cn(
        SWITCH,
        on
          ? tint === "accent"
            ? "border-accent bg-accent/15 text-accent"
            : "border-[color:var(--attention)] bg-[color:var(--attention)]/15 text-[color:var(--attention)]"
          : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The side count, which is the polygon's only setting and its whole point. */
function Sides(): React.JSX.Element {
  const sides = useAppState((state) => state.polygonSides);
  return (
    <span className="flex items-center gap-1" data-polygon-sides>
      <span className="text-2xs text-muted-foreground">Sides</span>
      <button
        type="button"
        onClick={() => store.setPolygonSides(sides - 1)}
        disabled={sides <= 3}
        aria-label="One side fewer"
        className={cn(
          SWITCH,
          "border-border text-muted-foreground hover:bg-card disabled:opacity-40",
        )}
      >
        −
      </button>
      <span className="w-4 text-center text-2xs tabular-nums text-foreground">{sides}</span>
      <button
        type="button"
        onClick={() => store.setPolygonSides(sides + 1)}
        disabled={sides >= 24}
        aria-label="One side more"
        className={cn(
          SWITCH,
          "border-border text-muted-foreground hover:bg-card disabled:opacity-40",
        )}
      >
        +
      </button>
    </span>
  );
}

export function OptionsBar({ glyphName }: { glyphName: string }): React.JSX.Element {
  const tool = useAppState((state) => state.tool);
  const snapping = useAppState((state) => state.snapping);
  const marks = useAppState((state) => state.marks);
  const guides = useAppState((state) => state.guides);
  const typeface = useAppState((state) => state.typeface);
  const info = toolInfo(tool);

  return (
    /*
      One line, always exactly as tall, whatever is in it.

      This has to be a fixed height rather than a bar that grows to fit,
      because the canvas below takes whatever height is left. A bar that wraps
      to two lines when the pen appears -- or when the pen has something to say
      about a letter whose ink has been taken -- shortens the canvas, which
      re-fits the letter at a different size while somebody is looking at it.
      The drawing must not resize because a sentence arrived above it.

      So it scrolls sideways rather than growing, and the prose in it gives way
      first. Every options bar in every drawing program is a fixed strip for
      the same reason.
    */
    <div
      data-options-bar
      className="flex h-9 shrink-0 items-center gap-x-3 overflow-x-auto overflow-y-hidden border-b border-border bg-card/40 px-3"
    >
      <span className="shrink-0 text-xs-plus font-medium text-foreground" data-options-tool>
        {info.name}
      </span>
      {/*
        What the tool does, in its own words, beside its name.

        The same sentence the flyout shows, which is deliberate: somebody who
        took the tool up from the flyout has already read it, and somebody who
        took it up with a key has not. It gives way first on a narrow window,
        because it is the one thing here that is prose.
      */}
      <span
        className="hidden min-w-0 flex-1 truncate text-2xs text-muted-foreground xl:block"
        title={info.hint}
      >
        {info.hint}
      </span>

      {tool === "polygon" && <Sides />}
      {/*
        The pen, beside the stroke it writes rather than in the Inspector.

        Its own panel, laid out in a row. The three numbers, which stop is
        being edited and what a change to them will reach are all still said,
        because all of them are the parts a person can get wrong -- what moved
        is where they are said, not what.
      */}
      {writesStrokes(tool) && <PenNumbers glyphName={glyphName} />}

      <span className="ml-auto flex shrink-0 items-center gap-2 pl-3">
        <GroundToggle />
        <Toggle
          on={snapping}
          onPress={() => store.setSnapping(!snapping)}
          tint="accent"
          data-snap-toggle
          title={
            snapping
              ? "A dragged point lands on whole units, the metric lines, the guides, and the letter's own points. Press to let it land anywhere."
              : "A dragged point lands wherever you let go of it. Press to pull it onto the lines worth landing on."
          }
        >
          Snap
        </Toggle>
        <Toggle
          on={marks}
          onPress={() => store.setMarks(!marks)}
          tint="attention"
          data-marks-toggle
          title={
            marks
              ? "Rings mark where a curve turns without a point on it, and crosses mark points a hair off smooth. Press to stop showing them."
              : "Ring the two faults you cannot see by looking: curves that turn with no point at the turn, and points a degree or two off smooth."
          }
        >
          Faults
        </Toggle>
        {/*
          The guides, at the end of the strip that is about how you draw.

          A guide is placed at the height the view is looking at rather than at
          a number typed into a box, because the reason to want one is almost
          always "here, level with this" -- and it is then dragged, which is
          the part that makes it useful. They belong to the font, so one placed
          while drawing an `n` is still there on the `o` you are lining up
          against it.
        */}
        <button
          type="button"
          onClick={() => typeface && store.addGuide(typeface.metrics.xHeight, "y")}
          data-add-guide
          title="Put a guide across the canvas, then drag it where you want it"
          className={cn(
            SWITCH,
            "border-border text-muted-foreground hover:bg-card hover:text-foreground",
          )}
        >
          Guide ―
        </button>
        <button
          type="button"
          onClick={() =>
            store.addGuide(Math.round((store.glyph(glyphName)?.advanceWidth ?? 500) / 2), "x")
          }
          data-add-guide-vertical
          title="Put a guide down the canvas, then drag it where you want it"
          className={cn(
            SWITCH,
            "border-border text-muted-foreground hover:bg-card hover:text-foreground",
          )}
        >
          Guide │
        </button>
        {guides.length > 0 && (
          <button
            type="button"
            onClick={() => store.clearGuides()}
            data-clear-guides
            className="rounded px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear {guides.length}
          </button>
        )}
      </span>
    </div>
  );
}
