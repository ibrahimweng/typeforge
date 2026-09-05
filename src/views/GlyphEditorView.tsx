/**
 * The glyph editor: direct manipulation of one letter's outline.
 *
 * The canvas shows the outline as the font will draw it, with the metric lines
 * a type designer works against and the bezier nodes on top. Nodes and handles
 * are dragged directly; the pen tool adds points.
 *
 * Editing works on the glyph's stored outline, not on the parametric result, so
 * family-wide parameters stay live on top of whatever is drawn here. The
 * parametric outline is shown behind as a guide when the two differ.
 *
 * What is left here is the framing and the chrome: how big the canvas is, where
 * the letter sits in it, which letters stand either side, and the markup around
 * all of that. The three things it does that are not framing are three hooks,
 * and they are separate because they are answerable separately:
 *
 *   - `glyph-gestures.ts` -- what the pointer is doing. Fourteen tools and
 *     fifteen kinds of drag, and nothing out here needs to know about any of
 *     them beyond the handlers to hang on the canvas.
 *   - `glyph-painting.ts` -- putting it on the canvas, which is a function of
 *     what is being edited and what the hand is doing.
 *   - `glyph-keys.ts` -- the keys about a letter, bound to the window.
 *
 * They were one file of eighteen hundred lines, which meant the hit tests, the
 * canvas calls and the markup were all in scope for each other and none of them
 * said what it needed. The order matters and is the only thing joining them:
 * the gesture is worked out first, and the other two are handed it.
 */

import * as React from "react";

import { contoursBounds } from "@/font/geometry";

import { resolveAdvanceWidth } from "@/font/transform";
import type { Glyph, Typeface, Vec2 } from "@/font/types";
import { cursorFor as cursorClass } from "@/font/tools";

import type { GlyphView } from "@/components/glyph-render";
import { store, useAppState, type ToolState } from "@/state/useStore";
import { useGlyphGestures } from "./glyph-gestures";
import { useGlyphKeys } from "./glyph-keys";
import { useGlyphPainting } from "./glyph-painting";
import { CoachMark } from "@/components/CoachMark";
import { GlyphFaults } from "@/components/GlyphFaults";
import { Versions } from "@/components/Versions";
import { GroundToggle } from "@/components/GroundToggle";
import { NumberField } from "@/components/NumberField";
import { NothingDrawnYet } from "@/components/NothingDrawnYet";
import { hasLetters } from "@/font/library";
import { ToolPalette } from "@/components/ToolPalette";
import { cn } from "@/ui/lib/utils";

import { clamp, parseNodeKey } from "./glyph-pointer";

export function GlyphEditorView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const glyph = store.glyph(state.selectedGlyph);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 800, height: 600 });
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState<Vec2>({ x: 0, y: 0 });

  /*
   * Measured through a callback ref, for the reason the font grid is.
   *
   * This view returns an empty state before the canvas exists, and the observer
   * used to be set up in an effect with no dependencies -- so on a render with
   * no font the ref was null, the effect took its early exit, and it never ran
   * again. Here that is latent rather than visible: the view is mounted and
   * unmounted by the switch above it, so by the time anybody can reach it there
   * is always a font and the ref is always there.
   *
   * It is fixed anyway, and not for tidiness. The identical shape in the font
   * grid was not latent: it left that grid at eight columns on every window
   * size, for ever, with the letters spilling out of their cells on a narrow
   * one. A fault that is currently invisible because of how a sibling component
   * happens to be rendered is a fault waiting for that to change.
   */
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    observerRef.current?.disconnect();
    if (!element) return;
    const read = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  // Reset the framing whenever a different glyph is opened.
  React.useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [state.selectedGlyph]);

  const view = React.useMemo<GlyphView>(() => {
    if (!typeface) return { scale: 1, originX: 0, originY: 0 };
    // Fit the full vertical range of the font, then apply the user's zoom.
    const span = typeface.metrics.ascender - typeface.metrics.descender;
    const base = (size.height * 0.72) / Math.max(1, span);
    const scale = base * zoom;
    return {
      scale,
      originX: size.width / 2 - (glyph ? (glyph.advanceWidth / 2) * scale : 0) + pan.x,
      originY: size.height / 2 + (span / 2 + typeface.metrics.descender) * scale + pan.y,
    };
  }, [typeface, size, zoom, pan, glyph]);

  /*
   * The letters standing either side, and where each of them sits.
   *
   * A sidebearing cannot be judged on a letter by itself. The gap on the left
   * of an `n` means nothing until there is something to its left; every editor
   * since the 1990s draws the neighbours for that reason, and this one did not,
   * which made the one thing the glyph view is for -- deciding whether a letter
   * is spaced right -- impossible without leaving it.
   *
   * Laid out with the real advances and the real kerning, because a neighbour
   * drawn at the wrong distance is worse than no neighbour: it answers the
   * question confidently and wrongly.
   */
  const neighbours = React.useMemo(() => {
    if (!typeface || !glyph) return { before: [], after: [] };
    const byCodepoint = new Map<number, Glyph>();
    for (const one of typeface.glyphs) {
      for (const codepoint of one.unicodes) {
        if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, one);
      }
    }
    const found = (text: string): Glyph[] =>
      [...text]
        .map((character) => byCodepoint.get(character.codePointAt(0)!))
        .filter((one) => one !== undefined);

    /*
     * Walked outwards from the glyph in both directions, so the pen starts at
     * the edited letter rather than at the start of a line. The left side is
     * built backwards -- each letter placed by its own width plus whatever it
     * kerns against what follows it -- which is the only way to keep the letter
     * under the cursor where it already is.
     */
    const placed: Array<{ glyph: Glyph; x: number }> = [];
    let pen = 0;
    let next = glyph;
    for (const one of found(state.context.before).reverse()) {
      pen -= resolveAdvanceWidth(one, typeface) + store.resolvedKerning(one.name, next.name).value;
      placed.push({ glyph: one, x: pen });
      next = one;
    }
    const before = placed;

    const after: Array<{ glyph: Glyph; x: number }> = [];
    let forward = resolveAdvanceWidth(glyph, typeface);
    let previous = glyph;
    for (const one of found(state.context.after)) {
      forward += store.resolvedKerning(previous.name, one.name).value;
      after.push({ glyph: one, x: forward });
      forward += resolveAdvanceWidth(one, typeface);
      previous = one;
    }
    return { before, after };
  }, [typeface, glyph, state.context, state.revision]);

  /*
   * Worked out first, because the other two are handed it.
   *
   * The painter draws what is hovered and what is being dragged; the keys
   * redraw and refresh the sentence after an edit, which is the pointer's job
   * done from the keyboard. Neither needs anything else the gesture holds.
   */
  const gesture = useGlyphGestures({ typeface, glyph, state, view, pan, setPan });

  useGlyphPainting({ canvas: canvasRef, typeface, glyph, state, view, size, neighbours, gesture });
  useGlyphKeys({ glyph, state, gesture });

  // --- interaction ------------------------------------------------------

  if (!typeface) {
    return <Centered>Open a font to start editing.</Centered>;
  }
  if (!glyph) {
    /*
     * A font with letters in it and none of them open is a different thing
     * from a font with no letters at all, and this used to say the same about
     * both -- sending somebody with an empty font to the one view that would
     * then tell them to press New letter.
     */
    if (!hasLetters(typeface)) return <NothingDrawnYet what="draw" />;
    return <Centered>Choose a glyph in the font view.</Centered>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="glyph" />
      {/*
        Which weight this letter is being drawn in, above the letter.

        The same argument the sidebearings below make: it is a decision about
        what you are looking at, taken while looking at it, and a control for
        that on the far side of the window is one somebody has to go and find.
        Nothing at all until there is a second weight to switch to.
      */}
      <Versions compact />
      {/*
        What stands either side, above the canvas rather than in the panel.

        It belongs with the letter it changes: this is a decision about what you
        are looking at, taken while looking at it, and a control for that on the
        far side of the window is a control somebody has to go and find.
      */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-2xs">
        <span className="text-muted-foreground">Between</span>
        <input
          value={state.context.before}
          onChange={(event) => store.setContext({ before: event.target.value })}
          aria-label="Letters before"
          data-context-before
          maxLength={8}
          className="h-7 w-16 rounded-md border border-input bg-card px-2 text-center text-xs-plus text-foreground outline-none focus-visible:border-accent"
        />
        <span className="rounded bg-card px-2 py-1 font-medium text-foreground">{glyph.name}</span>
        <input
          value={state.context.after}
          onChange={(event) => store.setContext({ after: event.target.value })}
          aria-label="Letters after"
          data-context-after
          maxLength={8}
          className="h-7 w-16 rounded-md border border-input bg-card px-2 text-center text-xs-plus text-foreground outline-none focus-visible:border-accent"
        />
        {/*
          The one thing in this row that can afford to give way.

          Everything else here is a control with a name on it, and a control
          whose name has wrapped -- `On` over `black` -- reads as broken. This
          is a sentence, so it can lose its last words to an ellipsis and still
          do its job, and the hover carries the whole of it. It only comes up on
          a narrow window or a long glyph name, but `newGlyph` is a long glyph
          name and it is the one every new letter starts with.
        */}
        {/*
          Gone rather than clipped, once there is no room to say anything.

          Truncation is fine while a few words survive; it is not fine at two.
          In a nine-hundred-pixel window this row is a label, three letter
          boxes, six controls and then whatever is left, and what was left was
          "Dr…" -- which says nothing and reads as a rendering fault rather than
          as a sentence that did not fit. The whole of it is still on the hover,
          where it was already, and the three letter boxes beside it are the
          thing the sentence is about.
        */}
        <span
          className="hidden min-w-0 flex-1 truncate pl-1 text-muted-foreground lg:block"
          title="Drawn flat and not editable — they are what this letter is spaced against, at their real advances and kerning."
        >
          Drawn flat and not editable — they are what this letter is spaced against, at their real
          advances and kerning.
        </span>

        {/*
          The guides, at the other end of the same row.

          A guide is placed at the height the view is looking at rather than at
          a number typed into a box, because the reason to want one is almost
          always "here, level with this" -- and it is then dragged, which is the
          part that makes it useful. They belong to the font, so one placed
          while drawing an `n` is still there on the `o` you are lining up
          against it.
        */}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <GroundToggle />
          {/*
            Two of them, because a guide was only ever horizontal and half of
            what anybody draws one for is vertical: where a stem should stand,
            where a sidebearing should fall.
          */}
          <button
            type="button"
            onClick={() => store.addGuide(typeface.metrics.xHeight, "y")}
            data-add-guide
            title="Put a guide across the canvas, then drag it where you want it"
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Guide ―
          </button>
          <button
            type="button"
            onClick={() => store.addGuide(Math.round((glyph?.advanceWidth ?? 500) / 2), "x")}
            data-add-guide-vertical
            title="Put a guide down the canvas, then drag it where you want it"
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Guide │
          </button>
          {/*
            Snapping is a switch rather than a modifier, because the two a drag
            already uses are taken: shift holds it to one axis and alt pans the
            canvas. A third would be a chord nobody would find.
          */}
          <button
            type="button"
            onClick={() => store.setSnapping(!state.snapping)}
            aria-pressed={state.snapping}
            data-snap-toggle
            title={
              state.snapping
                ? "A dragged point lands on whole units, the metric lines, the guides, and the letter's own points. Press to let it land anywhere."
                : "A dragged point lands wherever you let go of it. Press to pull it onto the lines worth landing on."
            }
            className={cn(
              "rounded border px-2 py-1 text-2xs transition-colors",
              state.snapping
                ? "border-accent bg-accent/15 text-accent"
                : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            Snap
          </button>
          {/*
            The faults, on a switch beside snapping because it is the same kind
            of thing: a way of drawing that is on or off, rather than something
            done once. Off by default -- a letter halfway through being drawn is
            covered in missing extremes and does not need telling.
          */}
          <button
            type="button"
            onClick={() => store.setMarks(!state.marks)}
            aria-pressed={state.marks}
            data-marks-toggle
            title={
              state.marks
                ? "Rings mark where a curve turns without a point on it, and crosses mark points a hair off smooth. Press to stop showing them."
                : "Ring the two faults you cannot see by looking: curves that turn with no point at the turn, and points a degree or two off smooth."
            }
            className={cn(
              "rounded border px-2 py-1 text-2xs transition-colors",
              state.marks
                ? "border-[color:var(--attention)] bg-[color:var(--attention)]/15 text-[color:var(--attention)]"
                : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            Faults
          </button>
          {/*
            The polygon's side count, shown only while the polygon is in hand.

            A control for a tool nobody has picked up is a control in the way,
            and this row is already the tightest in the view. Beside the tool
            rather than in the Inspector because it changes what the very next
            drag produces, and a person setting it is looking at the canvas.
          */}
          {state.tool === "polygon" && (
            <span className="flex items-center gap-1" data-polygon-sides>
              <span className="text-2xs text-muted-foreground">Sides</span>
              <button
                type="button"
                onClick={() => store.setPolygonSides(state.polygonSides - 1)}
                disabled={state.polygonSides <= 3}
                aria-label="One side fewer"
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40"
              >
                −
              </button>
              <span className="w-4 text-center text-2xs tabular-nums text-foreground">
                {state.polygonSides}
              </span>
              <button
                type="button"
                onClick={() => store.setPolygonSides(state.polygonSides + 1)}
                disabled={state.polygonSides >= 24}
                aria-label="One side more"
                className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40"
              >
                +
              </button>
            </span>
          )}
          {state.guides.length > 0 && (
            <button
              type="button"
              onClick={() => store.clearGuides()}
              data-clear-guides
              className="rounded px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear {state.guides.length}
            </button>
          )}
        </span>
      </div>
      {/*
        The ground, declared here rather than on the document.

        Custom properties inherit, so putting it on this element redefines the
        canvas colours for this subtree and for nothing else: the letters in
        the inspector a few pixels to the right, and the grid one tab over,
        keep the colours they were designed with. That is the whole scope of
        this -- the surface a letter is judged on, not a theme.
      */}
      <div className="flex min-h-0 flex-1">
        <ToolPalette />
        <div
          ref={measure}
          data-ground={state.ground}
          className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]"
        >
          <canvas
            ref={canvasRef}
            style={{ width: size.width, height: size.height }}
            className={cursorClass(state.tool, state.toolState, gesture.drag.current !== null)}
            onPointerDown={gesture.on.pointerDown}
            onPointerMove={gesture.on.pointerMove}
            onPointerUp={gesture.on.pointerUp}
            onPointerCancel={gesture.on.pointerUp}
            onDoubleClick={gesture.on.doubleClick}
            onPointerLeave={gesture.on.pointerLeave}
            onWheel={(event) => {
              // Ctrl or command with the wheel zooms, matching every design tool.
              if (event.ctrlKey || event.metaKey) {
                setZoom((current) => clamp(current * (event.deltaY < 0 ? 1.1 : 0.9), 0.1, 24));
              } else {
                setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
              }
            }}
          />
          {/*
          And what is wrong with this letter, over the letter.

          Every one of these faults was already found by the checker and only
          ever said on a separate page, which is a page somebody has to know to
          go and visit. An unclosed outline is a thing to fix while the pen is
          still in your hand. Nothing is drawn when there is nothing wrong.
        */}
          {typeface && glyph && (
            <GlyphFaults
              typeface={typeface}
              glyph={glyph}
              revision={state.revision}
              masters={state.masters}
            />
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-3 text-2xs text-muted-foreground tabular-nums">
            <span>{Math.round(zoom * 100)}%</span>
            {state.selectedNodes.size > 1 && <span>{state.selectedNodes.size} points</span>}
          </div>
        </div>
      </div>
      <Numbers
        glyph={glyph}
        typeface={typeface}
        selected={state.selectedNodes}
        toolState={state.toolState}
      />
    </div>
  );
}

/**
 * The numbers, under the letter.
 *
 * A point could be dragged and nothing else. Moving a stem three units sideways
 * was therefore not possible: you could get close by eye at a high zoom and
 * never land on a number, which is most of the difference between a tool a
 * designer will use and one they will admire and then go back to their own.
 *
 * Under the canvas rather than in the panel on the far right, because these are
 * about the letter and the letter is here. What is offered depends on what is
 * selected -- the point when there is exactly one, the letter's own spacing
 * otherwise -- so the row answers the question in front of you rather than
 * showing eight fields of which six are always dimmed.
 */
function Numbers({
  glyph,
  typeface,
  selected,
  toolState,
}: {
  glyph: Glyph;
  typeface: Typeface;
  selected: ReadonlySet<string>;
  /** What the tool in hand would do now, which takes this row when it has something to say. */
  toolState: ToolState;
}): React.JSX.Element {
  const one = selected.size === 1 ? parseNodeKey([...selected][0]) : null;
  const node = one ? glyph.contours[one.contour]?.nodes[one.node] : null;

  /*
   * The sidebearings, measured off the ink rather than stored.
   *
   * A sidebearing is not a field on a glyph: it is where the ink starts against
   * where the advance does, so it moves whenever the outline does. Measured
   * here for the same reason the Spacing table measures it -- a number kept
   * beside the outline is a number that goes stale the first time a point moves.
   */
  const box = glyph.contours.length > 0 ? contoursBounds(glyph.contours) : null;
  const advance = resolveAdvanceWidth(glyph, typeface);
  const left = box && Number.isFinite(box.xMin) ? Math.round(box.xMin) : 0;
  const right = box && Number.isFinite(box.xMax) ? Math.round(advance - box.xMax) : 0;

  const move = (axis: "x" | "y", next: number) => {
    if (!one) return;
    store.editGlyph(glyph.name, "Move point", (editing) => {
      const target = editing.contours[one.contour]?.nodes[one.node];
      if (!target) return;
      const delta = next - target.point[axis];
      target.point = { ...target.point, [axis]: next };
      // The handles travel with the point they belong to, exactly as they do
      // under a drag. Left behind, typing a coordinate would straighten the
      // curve either side of it.
      if (target.handleIn) {
        target.handleIn = { ...target.handleIn, [axis]: target.handleIn[axis] + delta };
      }
      if (target.handleOut) {
        target.handleOut = { ...target.handleOut, [axis]: target.handleOut[axis] + delta };
      }
    });
  };

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-1.5 text-2xs text-muted-foreground"
      data-glyph-numbers
    >
      <span className="font-medium text-foreground">{glyph.name}</span>

      {node ? (
        <>
          <span className="flex items-center gap-1">
            X
            <NumberField
              label="Point x"
              value={Math.round(node.point.x)}
              onCommit={(next) => move("x", next)}
            />
          </span>
          <span className="flex items-center gap-1">
            Y
            <NumberField
              label="Point y"
              value={Math.round(node.point.y)}
              onCommit={(next) => move("y", next)}
            />
          </span>
        </>
      ) : (
        /*
          What the tool in hand would do if you acted now, in its own words, and
          the point-typing hint only when there is no tool with anything to say.
          A line that changes as the gesture changes is worth more than a
          standing instruction: the knife saying "not across anything yet" is
          the difference between letting go and finding out, and finding out
          before you let go.
        */
        <span
          className={cn(
            "opacity-70",
            toolState.phase === "willDo" && "text-[color:var(--attention)] opacity-100",
          )}
          data-tool-says
        >
          {toolState.says ||
            (selected.size === 0
              ? "Select one point to type its position."
              : `${selected.size} points selected — one at a time can be typed.`)}
        </span>
      )}

      <span className="ml-auto flex items-center gap-x-5">
        <span className="flex items-center gap-1">
          Left
          <NumberField
            label="Left sidebearing"
            value={left}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - left, "left")}
          />
        </span>
        <span className="flex items-center gap-1">
          Width
          <NumberField
            label="Advance width"
            value={Math.round(advance)}
            onCommit={(next) =>
              store.editGlyph(glyph.name, "Set advance width", (editing) => {
                editing.advanceWidth = Math.max(0, next);
              })
            }
          />
        </span>
        <span className="flex items-center gap-1">
          Right
          <NumberField
            label="Right sidebearing"
            value={right}
            disabled={!box}
            onCommit={(next) => store.shiftSidebearing(glyph.name, next - right, "right")}
          />
        </span>
      </span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
      {children}
    </div>
  );
}
