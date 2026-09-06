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
import { canvasControls, framedAt } from "@/state/framing";
import { useGlyphGestures } from "./glyph-gestures";
import { useHand } from "./hand";
import { describeSelection, useGlyphKeys } from "./glyph-keys";
import { useGlyphPainting } from "./glyph-painting";
import { CanvasMenu, type MenuTarget } from "@/components/CanvasMenu";
import { CoachMark } from "@/components/CoachMark";
import { GlyphFaults } from "@/components/GlyphFaults";
import { Versions } from "@/components/Versions";
import { NumberField } from "@/components/NumberField";
import { NothingDrawnYet } from "@/components/NothingDrawnYet";
import { hasLetters } from "@/font/library";
import { cn } from "@/cn";

import { clamp, hitTestNode, parseNodeKey, segmentUnder } from "./glyph-pointer";

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
  const hand = useHand(canvasRef);
  const gesture = useGlyphGestures({ typeface, glyph, state, view, pan, setPan, hand: hand.held });

  useGlyphPainting({ canvas: canvasRef, typeface, glyph, state, view, size, neighbours, gesture });

  /*
   * The zoom, told to the strip along the bottom, and the two ways it may set
   * it from there.
   *
   * The number stays here, where the drawing is: a pan writes on every frame
   * of a drag, and putting the framing in the document store would re-render
   * the whole application sixty times a second for a letter nobody has
   * changed. What crosses is the one number the status bar shows and a pair of
   * functions, which is the smallest thing that lets somebody type 200 into a
   * field instead of rolling a wheel until it says it.
   */
  React.useEffect(() => {
    framedAt(typeface && glyph ? zoom : null);
  }, [zoom, typeface, glyph]);
  React.useEffect(() => {
    canvasControls({
      zoomTo: (next) => setZoom(next),
      fit: () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      },
    });
    return () => {
      canvasControls(null);
      framedAt(null);
    };
  }, []);

  /*
   * What a right click opened the menu on, if one is open.
   *
   * Worked out where the click happened rather than inside the menu, because
   * the hit tests want the view transform and the letter, and the menu wants
   * neither: it is handed a point and a path and turns them into verbs.
   */
  const [menu, setMenu] = React.useState<MenuTarget | null>(null);
  React.useEffect(() => setMenu(null), [state.selectedGlyph]);
  useGlyphKeys({ glyph, state, gesture, canvas: canvasRef });

  /*
   * Two things a screen reader needs and a canvas cannot give it.
   *
   * The keys, said once when the canvas takes focus, because `role`
   * "application" hands every keystroke to this view and somebody who cannot
   * see the letter has no other way to learn what Tab now does.
   *
   * And what is picked, said again whenever it changes. Walking an outline
   * with Tab moves a highlight around a drawing, which is the whole of the
   * feedback and is no feedback at all if the drawing cannot be seen. The
   * region below turns each step into a sentence.
   */
  const canvasKeysId = React.useId();
  const picked = React.useMemo(
    () => describeSelection(glyph, state.selectedNodes),
    [glyph, state.selectedNodes],
  );

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
          Gone rather than clipped, once there is no room to say anything.

          This is the one thing in the row that is prose rather than a control,
          so it is the one that can give way -- but truncation is only fine
          while a few words survive. When the row was also carrying six
          switches what was left of it was "Dr…", which says nothing and reads
          as a rendering fault rather than as a sentence that did not fit. The
          switches have gone to the options bar and this has room again; it
          still steps aside on a narrow window, where the three letter boxes
          beside it are the thing it is about.
        */}
        <span
          className="hidden min-w-0 flex-1 truncate pl-1 text-muted-foreground lg:block"
          title="Drawn flat and not editable — they are what this letter is spaced against, at their real advances and kerning."
        >
          Drawn flat and not editable — they are what this letter is spaced against, at their real
          advances and kerning.
        </span>

        {/*
          The switches, the guides and the polygon's sides used to end this row
          and are in the options bar now.

          They were never about the letters standing either side, which is what
          this row is for. They were here because there was nowhere else, and
          the cost of that was visible: on a nine-hundred-pixel window the
          sentence beside them was truncated to "Dr…" and the polygon's side
          count -- a control for the tool actually in hand -- was the first
          thing squeezed off the end.
        */}
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
        <div
          ref={measure}
          data-ground={state.ground}
          className="relative min-h-0 flex-1 overflow-hidden bg-[var(--canvas)]"
        >
          {/*
            The drawing surface, which until now no keyboard could reach and no
            screen reader could name.

            `tabIndex` puts it in the tab order, so the editing this view has
            always answered from the keyboard -- Tab to walk the points, arrows
            to nudge, Enter to close an outline -- can be got at without a
            pointer at all. It could not be, before: nothing here took focus, so
            the keys were answered from wherever the focus happened to be, which
            is the fault `glyph-keys.ts` describes.

            `role="application"` because that is what this is. The role tells a
            screen reader to stop interpreting keys itself and hand them
            straight through, which is right for a surface where Tab means the
            next point rather than the next control -- and it is only honest
            when the keys are then described, which is what `canvasKeysId` is
            for. `aria-label` names the letter, because "canvas" says nothing
            about which of six thousand is on screen.
          */}
          {/*
            The rule below reads `role="application"` as a non-interactive role
            put on an interactive element, which is true by the taxonomy and
            not a fault here.

            `application` is a document-structure role rather than a widget
            one, so a rule sorting roles into interactive and not puts it on
            the wrong side. What it actually does is tell a screen reader to
            stop interpreting keys itself and hand them through, and that is
            the only way the arrows reach this editor: in the browse mode a
            screen reader uses by default, an arrow press moves through the
            document and never arrives.

            It is a role worth being careful with, because it takes away the
            navigation somebody relies on everywhere else, and the two things
            that make it safe are both here. The keys are described, on the
            element, so they are read out on arriving. And Tab genuinely
            leaves -- which it did not before this commit, and which is the
            fault `glyph-keys.ts` describes. A surface nobody can get out of
            is the real version of what this rule is worried about.
          */}
          {/* biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: see above. */}
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="application"
            aria-label={glyph ? `Outline editor, editing ${glyph.name}` : "Outline editor"}
            aria-describedby={canvasKeysId}
            data-glyph-canvas
            style={{ width: size.width, height: size.height }}
            className={cn(
              /*
                A hand while space is down, and a closed one while it is being
                dragged. `active:` rather than a second render, because the
                cursor has to change on the press itself: waiting for React
                would show the open hand for a frame after the drag started.
              */
              hand.out
                ? "cursor-grab active:cursor-grabbing"
                : cursorClass(state.tool, state.toolState, gesture.drag.current !== null),
              // Focus has to be visible, or being in the tab order is a place
              // somebody arrives at without being told they have.
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--inspect)] focus-visible:ring-inset",
            )}
            onPointerDown={(event) => {
              /*
               * Focused when it is pointed at, which is what lets the keys
               * belong to the canvas without taking anything away.
               *
               * Clicking a point and then pressing an arrow is the sequence
               * the old window-wide binding existed for. It still works,
               * because the click is now also what puts the focus here.
               * Chromium focuses a `tabIndex` element on mousedown by itself
               * and WebKit does not, so it is asked for rather than assumed.
               */
              event.currentTarget.focus();
              gesture.on.pointerDown(event);
            }}
            onContextMenu={(event) => {
              /*
                Opened on whatever is under the pointer, which is the whole
                idea: the thing clicked is the argument, so every line in the
                menu can be a verb and the menu can be short.
              */
              event.preventDefault();
              if (!glyph) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
              const node = hitTestNode(glyph, view, at);
              setMenu({
                x: event.clientX,
                y: event.clientY,
                node,
                // Only when the click missed every point. A click on a point is
                // about that point, and offering to put another one on the edge
                // underneath it is offering the wrong thing confidently.
                edge: node ? null : segmentUnder(glyph, view, at),
              });
            }}
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
            The keys, for a screen reader, and what is picked, as it changes.

            Both are visually hidden rather than absent: they are the same
            facts the drawing already shows, said for somebody who cannot see
            it. `sr-only` keeps them out of the layout without keeping them out
            of the accessibility tree, which `display: none` would.

            The live region is polite because walking an outline is a run of
            small steps and an assertive one would interrupt itself on every
            press.
          */}
          <span id={canvasKeysId} className="sr-only">
            Tab and Shift Tab walk the points of a path. Arrow keys nudge what is picked, and hold
            Shift to nudge ten units at a time. Control or Command with A picks every point.
            Backspace deletes them. Enter closes an outline and Escape leaves it open.
          </span>
          <span aria-live="polite" aria-atomic="true" className="sr-only" data-glyph-picked>
            {picked}
          </span>
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
          {/*
            How many points are picked, over the letter.

            The zoom used to be beside it and has gone to the status bar, where
            it is a field somebody can type into rather than a number they can
            only read. This is the half that has no control to be: it is a fact
            about the drawing, so it stays on the drawing.
          */}
          {state.selectedNodes.size > 1 && (
            <div className="pointer-events-none absolute bottom-3 left-3 text-2xs text-muted-foreground tabular-nums">
              {state.selectedNodes.size} points
            </div>
          )}
          {menu && (
            <CanvasMenu
              target={menu}
              glyphName={glyph.name}
              selected={state.selectedNodes}
              onClose={() => {
                setMenu(null);
                // What the next click would do can change with what was just
                // chosen, and the sentence under the canvas has to catch up.
                gesture.refreshPhase();
              }}
            />
          )}
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
